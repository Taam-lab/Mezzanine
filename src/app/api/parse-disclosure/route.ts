import { NextRequest, NextResponse } from "next/server";
import { fetchDisclosureBodyText } from "@/lib/dartScrape";
import { extractPutCall, type PutCallExtraction } from "@/lib/putCallExtract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30; // 스크래핑 여유

// ──────────────────────────────────────────────
// Schema & helpers
// ──────────────────────────────────────────────

interface ParsedDisclosure {
  assetName?: string;
  underlyingCompanyName?: string;
  underlyingTicker?: string;
  underlyingMarket?: "KOSPI" | "KOSDAQ";
  mezzanineType?: "CB" | "BW" | "EB";
  issueDate?: string;
  maturityDate?: string;
  issueAmount?: number;
  couponRate?: number;
  ytm?: number;
  initialConversionPrice?: number;
  minConversionPrice?: number;
  conversionStartDate?: string;
  conversionEndDate?: string;
  putOptionRate?: number;
  putOptionStartDate?: string;
  putOptionEndDate?: string;
  callOptionRatio?: number;
  callOptionRate?: number;
  callOptionStartDate?: string;
  callOptionEndDate?: string;
  seriesNumber?: number;
  sourceDisclosureUrl?: string;
}

const DART_BASE = "https://opendart.fss.or.kr/api";

function extractRcpNo(url: string): string | null {
  const m = url.match(/rcpNo=(\d+)/i);
  return m ? m[1] : null;
}

function cleanCompanyName(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return raw
    .replace(/주식회사/g, "")
    .replace(/㈜|\(주\)/g, "")
    .replace(/\s+/g, " ")
    .trim() || undefined;
}

function toNumber(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "-" || v === "") return undefined;
  const cleaned = String(v).replace(/,/g, "").replace(/[^\d.\-]/g, "");
  if (!cleaned) return undefined;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

function toDate(v: unknown): string | undefined {
  if (!v) return undefined;
  const s = String(v).trim();
  // YYYY-MM-DD, YYYY.MM.DD, YYYY/MM/DD, YYYY년 MM월 DD일
  const m = s.match(/(\d{4})[년\-./\s]+(\d{1,2})[월\-./\s]+(\d{1,2})/);
  if (!m) return undefined;
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function corpClsToMarket(cls: string | undefined): "KOSPI" | "KOSDAQ" | undefined {
  if (cls === "Y") return "KOSPI";
  if (cls === "K") return "KOSDAQ";
  return undefined;
}

// ──────────────────────────────────────────────
// DART API calls
// ──────────────────────────────────────────────

interface DartListItem {
  corp_code?: string;
  corp_name?: string;
  stock_code?: string;
  corp_cls?: string;
  report_nm?: string;
  rcept_no?: string;
  rcept_dt?: string;
  flr_nm?: string;
  rm?: string;
}

interface DartListPage {
  list: DartListItem[];
  totalPage: number;
}

async function fetchListPage(
  date: string,
  pageNo: number,
  pblntfTy: string,
  apiKey: string,
): Promise<DartListPage | null> {
  const params = new URLSearchParams({
    crtfc_key: apiKey,
    bgn_de: date,
    end_de: date,
    page_no: String(pageNo),
    page_count: "100",
  });
  if (pblntfTy) params.set("pblntf_ty", pblntfTy);
  const url = `${DART_BASE}/list.json?${params.toString()}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`list.json HTTP ${res.status}`);
  const data = await res.json() as {
    status?: string;
    message?: string;
    list?: DartListItem[];
    total_page?: number;
  };
  // 013 = no data → 빈 페이지로 취급
  if (data.status === "013") return { list: [], totalPage: 0 };
  if (data.status && data.status !== "000") {
    throw new Error(`list.json: ${data.status} ${data.message ?? ""}`);
  }
  return { list: data.list ?? [], totalPage: data.total_page ?? 1 };
}

/**
 * DART list.json은 `rcept_no` 단독 필터를 지원하지 않음 (corp_code 또는 날짜범위 필요).
 * 따라서 rcpNo의 앞 8자리(접수일)로 그 날짜의 공시 목록을 받아온 뒤
 * rcept_no가 정확히 일치하는 항목을 찾는다.
 *
 * 최적화: 페이지 1-3을 병렬로 던져 wall-clock을 줄인다.
 * 카테고리도 주요사항보고서(B)와 전체(빈값)를 병렬로 시도.
 */
async function fetchDartList(rcpNo: string, apiKey: string): Promise<DartListItem | null> {
  if (!/^\d{14}$/.test(rcpNo)) {
    throw new Error(`잘못된 rcept_no 형식: ${rcpNo}`);
  }
  const date = rcpNo.slice(0, 8);

  // 1단계: B 카테고리 페이지 1-3 병렬 (대부분 여기서 잡힘)
  const firstBatch = await Promise.all(
    [1, 2, 3].map((p) => fetchListPage(date, p, "B", apiKey).catch(() => null)),
  );
  for (const page of firstBatch) {
    const found = page?.list.find((item) => item.rcept_no === rcpNo);
    if (found) return found;
  }
  const bMaxPage = Math.max(0, ...firstBatch.map((p) => p?.totalPage ?? 0));

  // 2단계: B 카테고리에 페이지가 더 있으면 4-5 병렬 + 전체 카테고리 1-3 병렬 동시 진행
  const secondBatch = await Promise.all([
    ...(bMaxPage > 3
      ? [4, 5].filter((p) => p <= bMaxPage).map((p) =>
          fetchListPage(date, p, "B", apiKey).catch(() => null),
        )
      : []),
    ...[1, 2, 3].map((p) => fetchListPage(date, p, "", apiKey).catch(() => null)),
  ]);
  for (const page of secondBatch) {
    const found = page?.list.find((item) => item.rcept_no === rcpNo);
    if (found) return found;
  }

  return null;
}

/**
 * 공시 종류 판별 — report_nm 기준
 * CB: 전환사채권 / BW: 신주인수권부사채권 / EB: 교환사채권
 */
function detectMezzanineType(reportNm: string | undefined): "CB" | "BW" | "EB" | null {
  if (!reportNm) return null;
  if (/전환사채/.test(reportNm)) return "CB";
  if (/신주인수권부사채/.test(reportNm)) return "BW";
  if (/교환사채/.test(reportNm)) return "EB";
  return null;
}

const ENDPOINTS: Record<"CB" | "BW" | "EB", string> = {
  CB: "cvbdIsDecsn.json",
  BW: "bdwtIsDecsn.json",
  EB: "exbdIsDecsn.json",
};

async function fetchStructuredDecision(
  type: "CB" | "BW" | "EB",
  corpCode: string,
  filingDate: string, // YYYYMMDD
  apiKey: string,
): Promise<Array<Record<string, unknown>> | null> {
  // 공시 접수일 기준 ±3일 윈도우로 조회 (정정공시 등 약간의 시차 대응)
  const dt = new Date(
    `${filingDate.slice(0, 4)}-${filingDate.slice(4, 6)}-${filingDate.slice(6, 8)}T00:00:00Z`,
  );
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;

  const bgn = new Date(dt);
  bgn.setUTCDate(bgn.getUTCDate() - 3);
  const end = new Date(dt);
  end.setUTCDate(end.getUTCDate() + 3);

  const endpoint = ENDPOINTS[type];
  const url = `${DART_BASE}/${endpoint}?crtfc_key=${apiKey}&corp_code=${corpCode}&bgn_de=${fmt(bgn)}&end_de=${fmt(end)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`${endpoint} HTTP ${res.status}`);
  const data = await res.json() as {
    status?: string;
    message?: string;
    list?: Array<Record<string, unknown>>;
  };
  if (data.status && data.status !== "000") {
    throw new Error(`${endpoint}: ${data.status} ${data.message ?? ""}`);
  }
  return data.list ?? null;
}

/**
 * 정형 API 응답 한 row를 우리 스키마로 매핑
 *
 * DART CB(전환사채권 발행결정) 정형 API 필드 — 실제 응답 키와 다를 수 있어
 * 여러 키 후보를 폴백으로 시도. 모르는 키는 _rawDecision으로 디버그에 반환.
 */
function mapDecisionToSchema(
  row: Record<string, unknown>,
  type: "CB" | "BW" | "EB",
  meta: DartListItem,
): { data: Partial<ParsedDisclosure>; filled: string[]; unfilled: string[] } {
  const get = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null && row[k] !== "" && row[k] !== "-") {
        return row[k];
      }
    }
    return undefined;
  };

  const data: Partial<ParsedDisclosure> = {};
  const filled: string[] = [];
  const unfilled: string[] = [];

  const set = <K extends keyof ParsedDisclosure>(key: K, value: ParsedDisclosure[K] | undefined) => {
    if (value !== undefined && value !== null && value !== "") {
      (data as Record<string, unknown>)[key] = value;
      filled.push(key);
    } else {
      unfilled.push(key);
    }
  };

  set("mezzanineType", type);

  // 회사명 / 종목코드 / 시장
  const corpName = cleanCompanyName(meta.corp_name ?? (get("corp_name") as string));
  set("underlyingCompanyName", corpName);
  const stockCode = (meta.stock_code ?? (get("stock_code") as string))?.trim();
  set("underlyingTicker", stockCode && /^\d{6}$/.test(stockCode) ? stockCode : undefined);
  set("underlyingMarket", corpClsToMarket(meta.corp_cls ?? (get("corp_cls") as string)));

  // 회차
  const seriesNumber = toNumber(get("bd_tm"));
  set("seriesNumber", seriesNumber);

  // 자산명: "<회사명> <회차>회차 <CB/BW/EB>"
  if (corpName && seriesNumber !== undefined) {
    set("assetName", `${corpName} ${seriesNumber}회차 ${type}`);
  } else if (corpName) {
    set("assetName", `${corpName} ${type}`);
  } else {
    unfilled.push("assetName");
  }

  // 금액
  set("issueAmount", toNumber(get("bd_fta")));

  // 이자율
  set("couponRate", toNumber(get("bd_intr_ex")));
  set("ytm", toNumber(get("bd_intr_sf")));

  // 날짜
  set("issueDate", toDate(get("pymd")));
  set("maturityDate", toDate(get("bd_mtd")));

  // 전환가액 / 청구기간
  // CB 실측 키: cv_prc / cvrqpd_bgd / cvrqpd_edd / act_mktprcfl_cvprc_lwtrsprc
  // EB 는 ex_* / exrqpd_* / act_mktprcfl_exprc_lwtrsprc 로 대칭 명명될 가능성이 높음
  // BW 는 신주인수권 관련 필드 (ss_* 계열)
  const initialPrice = toNumber(get("cv_prc", "ex_prc", "ss_prc"));
  set("initialConversionPrice", initialPrice);

  // EB(교환사채)는 리픽싱이 없어서 정형 API에 최저 전환가액이 없음.
  // 실무상 최초 교환가액 = 최저 교환가액이므로 initial을 그대로 사용.
  const rawMin = toNumber(
    get(
      "act_mktprcfl_cvprc_lwtrsprc",
      "act_mktprcfl_exprc_lwtrsprc",
      "act_mktprcfl_ssprc_lwtrsprc",
    ),
  );
  const effectiveMin = rawMin ?? (type === "EB" ? initialPrice : undefined);
  set("minConversionPrice", effectiveMin);
  set(
    "conversionStartDate",
    toDate(
      get(
        "cvrqpd_bgd",
        "exrqpd_bgd",
        "ssrqpd_bgd",
        "cv_rqsr_pd_bgd",
        "ex_rqsr_pd_bgd",
        "ss_rqsr_pd_bgd",
        "cv_rqsr_h_bgd",
        "ex_rqsr_h_bgd",
      ),
    ),
  );
  set(
    "conversionEndDate",
    toDate(
      get(
        "cvrqpd_edd",
        "exrqpd_edd",
        "ssrqpd_edd",
        "cv_rqsr_pd_edd",
        "ex_rqsr_pd_edd",
        "ss_rqsr_pd_edd",
        "cv_rqsr_h_endd",
        "ex_rqsr_h_endd",
      ),
    ),
  );

  // 풋옵션(조기상환청구권) / 콜옵션(매도청구권)
  // — DART 전환사채 정형 API는 이 필드들을 제공하지 않는다.
  // 후보 키를 몇 개 시도해두되, 대부분의 공시에서는 못 채워짐 (수동 입력 필요).
  set("putOptionStartDate", toDate(get("rs_inh_pd_bgd", "atrs_rs_inh_h_bgd", "rs_inh_h_bgd")));
  set("putOptionEndDate", toDate(get("rs_inh_pd_edd", "atrs_rs_inh_h_endd", "rs_inh_h_endd")));
  set("putOptionRate", toNumber(get("rs_inh_yr", "atrs_rs_inh_yr")));

  set("callOptionStartDate", toDate(get("dlst_pd_bgd", "atrs_dlst_h_bgd", "dlst_h_bgd")));
  set("callOptionEndDate", toDate(get("dlst_pd_edd", "atrs_dlst_h_endd", "dlst_h_endd")));
  set("callOptionRatio", toNumber(get("dlst_rt", "atrs_dlst_rt")));
  set("callOptionRate", toNumber(get("dlst_yr", "atrs_dlst_yr")));

  return { data, filled, unfilled };
}

// ──────────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url: string };

    if (!url?.includes("dart.fss.or.kr")) {
      return NextResponse.json(
        { error: "DART 공시 URL을 입력해주세요. (https://dart.fss.or.kr/...)" },
        { status: 400 },
      );
    }

    const rcpNo = extractRcpNo(url);
    if (!rcpNo) {
      return NextResponse.json(
        { error: "URL에서 공시 번호(rcpNo)를 찾을 수 없습니다." },
        { status: 400 },
      );
    }

    const apiKey = process.env.DART_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DART_API_KEY 환경변수가 설정되지 않았습니다." },
        { status: 500 },
      );
    }

    // 1단계: list.json으로 공시 메타 조회
    const meta = await fetchDartList(rcpNo, apiKey);
    if (!meta) {
      return NextResponse.json(
        { error: `공시번호 ${rcpNo}를 DART에서 찾을 수 없습니다.` },
        { status: 404 },
      );
    }

    // 2단계: 공시 종류 판별
    const type = detectMezzanineType(meta.report_nm);
    if (!type) {
      return NextResponse.json(
        {
          error: `메자닌(CB/BW/EB) 발행결정 공시가 아닙니다: "${meta.report_nm}"`,
          _meta: meta,
        },
        { status: 422 },
      );
    }

    // 3단계: 정형 API 호출
    if (!meta.corp_code || !meta.rcept_dt) {
      return NextResponse.json(
        { error: "공시 메타에 corp_code 또는 rcept_dt가 없습니다.", _meta: meta },
        { status: 502 },
      );
    }

    const list = await fetchStructuredDecision(type, meta.corp_code, meta.rcept_dt, apiKey);
    if (!list || list.length === 0) {
      return NextResponse.json(
        {
          error: `${type} 정형 API에서 공시번호 ${rcpNo} 데이터를 찾을 수 없습니다. (API 권한 또는 정정공시 가능성)`,
          _meta: meta,
        },
        { status: 502 },
      );
    }

    // 4단계: rcept_no로 정확히 매칭, 없으면 첫 row 사용
    const row = list.find((r) => r.rcept_no === rcpNo) ?? list[0];

    // 5단계: 스키마 매핑
    const { data, filled, unfilled } = mapDecisionToSchema(row, type, meta);
    data.sourceDisclosureUrl = url;

    // 6단계: 풋/콜 조항은 정형 API에 없으므로 원문 스크래핑 + 정규식 추출
    const putCallKeys: Array<keyof PutCallExtraction> = [
      "putOptionStartDate",
      "putOptionEndDate",
      "putOptionRate",
      "putOptionSchedule",
      "callOptionStartDate",
      "callOptionEndDate",
      "callOptionRatio",
      "callOptionRate",
    ];
    // schedule은 unfilled로 안 뜨는 계산 필드지만, 풋옵션 필드가 하나라도 비어있으면 스크래핑 트리거
    const missingPutCall = putCallKeys.filter((k) => k !== "putOptionSchedule" && unfilled.includes(k));
    let scrapeStatus: string | undefined;
    let extracted: PutCallExtraction | undefined;

    if (missingPutCall.length > 0) {
      try {
        const bodyText = await fetchDisclosureBodyText(rcpNo);
        extracted = extractPutCall(bodyText);
        const merged: string[] = [];
        for (const k of putCallKeys) {
          if (extracted[k] === undefined) continue;
          (data as Record<string, unknown>)[k] = extracted[k];
          // schedule은 계산용 내부 필드라 사용자 노출 목록에는 넣지 않음
          if (k !== "putOptionSchedule" && !filled.includes(k)) {
            filled.push(k);
            merged.push(k);
          }
        }
        const filledSet = new Set(filled);
        for (let i = unfilled.length - 1; i >= 0; i--) {
          if (filledSet.has(unfilled[i])) unfilled.splice(i, 1);
        }
        scrapeStatus = `본문 ${bodyText.length}자 스크래핑 → 풋/콜 ${merged.length}개 추출 (${merged.join(",") || "없음"})`;
      } catch (err) {
        scrapeStatus = `스크래핑 실패: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`;
      }
    }

    return NextResponse.json({
      data,
      autoFilledFields: filled,
      failedFields: unfilled,
      _meta: meta,
      _rawDecision: row,
      _scrapeStatus: scrapeStatus,
      _extractedPutCall: extracted,
    });
  } catch (err) {
    console.error("[parse-disclosure]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `파싱 중 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
