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

/**
 * 오늘(KST)에서 daysAgo 일 전 날짜를 YYYYMMDD 로.
 *
 * DART 의 rcept_dt 는 한국 날짜다. 서버(Vercel)는 UTC 라서 로컬 getDate() 로
 * 범위를 잡으면 KST 00~09시에는 end_de 가 "어제"가 되어, 그날 아침 일찍 접수된
 * 공시가 09시까지 조회 범위 밖에 있었다.
 */
function kstYmd(daysAgo = 0): string {
  const kst = new Date(Date.now() + 9 * 3600_000 - daysAgo * 86_400_000);
  return kst.toISOString().slice(0, 10).replace(/-/g, "");
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
  const url = `${DART_BASE}/list.json?crtfc_key=${apiKey}&corp_code=${corpCode}&bgn_de=${kstYmd(days)}&end_de=${kstYmd(0)}&page_count=100&page_no=1`;
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
