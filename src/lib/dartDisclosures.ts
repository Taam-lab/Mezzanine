/**
 * DART OpenAPI 기반 공시 조회.
 * Naver 스크래핑보다 안정적 (공식 채널, rcept_no · corp_code · report_nm 정형 필드).
 * 단점: list.json 이 corp_code 로만 필터되고 stock_code 로 못 씀 → Position.corp_code 필요.
 */

const DART_BASE = "https://opendart.fss.or.kr/api";

export interface DartDisclosure {
  title: string;
  url: string;
  date: string; // YYYY.MM.DD (표시용)
  isoDate: string; // YYYY-MM-DD (정렬용)
  rcpNo: string;
  reportName: string;
}

function pad2(n: number | string): string {
  return String(n).padStart(2, "0");
}

function fmtYmd(d: Date): string {
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
}

/**
 * corp_code로 최근 days일 공시 목록 조회.
 * page_count=100 · page_no=1 로 1페이지만 (최근 100건이면 충분).
 */
export async function fetchDartDisclosuresByCorpCode(
  corpCode: string,
  apiKey: string,
  days = 30,
): Promise<DartDisclosure[]> {
  const end = new Date();
  const bgn = new Date();
  bgn.setDate(bgn.getDate() - days);
  const url = `${DART_BASE}/list.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bgn_de=${fmtYmd(bgn)}&end_de=${fmtYmd(end)}&page_count=100&page_no=1`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      status?: string;
      list?: Array<{
        rcept_no: string;
        rcept_dt: string;
        report_nm: string;
        corp_name?: string;
      }>;
    };
    // 013 = no data
    if (data.status === "013") return [];
    if (data.status && data.status !== "000") return [];
    return (data.list ?? []).map((item) => ({
      title: item.report_nm,
      reportName: item.report_nm,
      url: `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}`,
      date: `${item.rcept_dt.slice(0, 4)}.${item.rcept_dt.slice(4, 6)}.${item.rcept_dt.slice(6, 8)}`,
      isoDate: `${item.rcept_dt.slice(0, 4)}-${item.rcept_dt.slice(4, 6)}-${item.rcept_dt.slice(6, 8)}`,
      rcpNo: item.rcept_no,
    }));
  } catch {
    return [];
  }
}

/**
 * rcpNo 로부터 corp_code 를 역으로 조회 (list.json 그 날 페이지 스캔).
 * Position 에 corp_code 가 없을 때 sourceDisclosureUrl 의 rcpNo 로 처음 한번 backfill 하는 용도.
 */
export async function resolveCorpCodeByRcpNo(
  rcpNo: string,
  apiKey: string,
): Promise<string | null> {
  if (!/^\d{14}$/.test(rcpNo)) return null;
  const date = rcpNo.slice(0, 8);
  // 1페이지 100개 먼저, 없으면 2-3페이지
  for (const pageNo of [1, 2, 3]) {
    const url = `${DART_BASE}/list.json?crtfc_key=${apiKey}&bgn_de=${date}&end_de=${date}&page_count=100&page_no=${pageNo}`;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        cache: "no-store",
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        status?: string;
        list?: Array<{ rcept_no: string; corp_code?: string }>;
        total_page?: number;
      };
      if (data.status === "013") return null;
      if (data.status && data.status !== "000") return null;
      const hit = data.list?.find((i) => i.rcept_no === rcpNo);
      if (hit?.corp_code) return hit.corp_code;
      if (!data.total_page || pageNo >= data.total_page) return null;
    } catch {
      return null;
    }
  }
  return null;
}
