/**
 * KOSCOM CHECK API 실시간 국내주식 시세 어댑터.
 *
 * 엔드포인트: POST https://checkapi.koscom.co.kr/stock/m001/basic_info_all
 * 인증: cust_id (10자리 CHECK 단말 고객번호) + auth_key 를 body에 함께 전송
 * 응답: { success: true, results: [Data Set] } 또는 { success: false, message: {...} }
 */

const CHECK_URL = "https://checkapi.koscom.co.kr/stock/m001/basic_info_all";

// 조회하려는 필드 (전체 필드는 응답이 무겁고, 우리는 아래만 필요)
const DATA_FIELDS = [
  "F15001", // 현재가
  "F15004", // 등락률
  "F15015", // 거래량
  "F15028", // 시가총액
  "F03003", // 전일종가
  "F16002", // 한글종목명
  "F15007", // 기준가
] as const;

interface CheckErrorMessage {
  errmsg?: string;
  desc?: string;
}

interface CheckResponse {
  success?: boolean;
  results?: Array<Record<string, unknown>>;
  message?: CheckErrorMessage;
}

export interface Quote {
  ticker: string;
  price: number;
  changeAmount: number; // 원 단위
  changeRate: number; // %
  volume?: number;
  marketCap?: number; // 원 단위
  stockName?: string;
  tradedAt?: string; // ISO 8601 (호출 시각으로 stub)
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function toStr(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

export async function fetchQuote(ticker: string): Promise<Quote> {
  const custId = process.env.CHECK_CUST_ID;
  const authKey = process.env.CHECK_AUTH_KEY;
  if (!custId || !authKey) {
    throw new Error("CHECK_CUST_ID / CHECK_AUTH_KEY 환경변수가 설정되지 않았습니다.");
  }

  const res = await fetch(CHECK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cust_id: custId,
      auth_key: authKey,
      jcode: ticker,
      data_list: DATA_FIELDS.join(","),
    }),
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) throw new Error(`CHECK HTTP ${res.status}`);

  const data = (await res.json()) as CheckResponse;
  if (!data.success) {
    const err = data.message?.errmsg ?? "unknown";
    const desc = data.message?.desc ?? "";
    throw new Error(`CHECK 응답 실패: ${err}${desc ? ` (${desc})` : ""}`);
  }

  const row = data.results?.[0];
  if (!row) throw new Error("CHECK 응답에 데이터 없음");

  const price = toNum(row.F15001);
  if (price === undefined) throw new Error("현재가(F15001) 파싱 실패");

  const prevClose = toNum(row.F03003) ?? toNum(row.F15007);
  const changeAmount = prevClose !== undefined ? price - prevClose : 0;

  return {
    ticker,
    price,
    changeAmount,
    changeRate: toNum(row.F15004) ?? 0,
    volume: toNum(row.F15015),
    marketCap: toNum(row.F15028), // 원 단위로 가정 (BIGINT)
    stockName: toStr(row.F16002),
    tradedAt: new Date().toISOString(),
  };
}
