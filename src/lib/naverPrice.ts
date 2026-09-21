interface NaverStockData {
  closePrice?: string;
  compareToPreviousClosePrice?: string;
  fluctuationsRatio?: string;
  accumulatedTradingVolume?: string;
  marketValue?: string;
  localTradedAt?: string;
  stockName?: string;
}

interface NaverPollingResponse {
  datas?: NaverStockData[];
  resultCode?: string;
}

export interface NaverQuote {
  ticker: string;
  price: number;
  changeAmount: number;
  changeRate: number;
  volume?: number;
  marketCap?: number; // 억원 단위
  stockName?: string;
  tradedAt?: string;
}

function toNum(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

const NAVER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  Referer: "https://finance.naver.com/",
  Accept: "application/json, text/plain, */*",
};

/** 1차: polling.finance.naver.com — 응답이 { datas: [ {...} ] } */
async function fetchViaPolling(ticker: string): Promise<NaverQuote> {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${ticker}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: NAVER_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`polling HTTP ${res.status}`);
  const data = (await res.json()) as NaverPollingResponse;
  const row = data.datas?.[0];
  if (!row) throw new Error("polling 응답에 datas 없음");
  const price = toNum(row.closePrice);
  if (price === undefined) throw new Error("polling 현재가 없음");
  return {
    ticker,
    price,
    changeAmount: toNum(row.compareToPreviousClosePrice) ?? 0,
    changeRate: toNum(row.fluctuationsRatio) ?? 0,
    volume: toNum(row.accumulatedTradingVolume),
    marketCap: toNum(row.marketValue),
    stockName: row.stockName,
    tradedAt: row.localTradedAt,
  };
}

/** 2차: api.stock.naver.com — 응답이 flat object (fallback) */
async function fetchViaApiStock(ticker: string): Promise<NaverQuote> {
  const url = `https://api.stock.naver.com/stock/${ticker}/basic`;
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: NAVER_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`api.stock HTTP ${res.status}`);
  const row = (await res.json()) as Record<string, unknown>;
  const price = toNum(row.closePrice as string | undefined);
  if (price === undefined) throw new Error("api.stock 현재가 없음");
  return {
    ticker,
    price,
    changeAmount: toNum(row.compareToPreviousClosePrice as string | undefined) ?? 0,
    changeRate: toNum(row.fluctuationsRatio as string | undefined) ?? 0,
    volume: toNum(row.accumulatedTradingVolume as string | undefined),
    marketCap: toNum(row.marketValue as string | undefined),
    stockName: row.stockName as string | undefined,
    tradedAt: row.localTradedAt as string | undefined,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 네이버 실시간 시세.
 *
 * 실패 모드별 대응:
 *  - 엔드포인트 한쪽 장애 → polling → api.stock 순차 폴백
 *  - 일시적 429/502/타임아웃 → 지터 백오프 후 primary 1회 재시도
 *
 * 재시도는 polling 만 다시 때린다 (전체 사다리를 반복하면 최악 타임아웃이
 * 4s×4 = 16s 까지 쌓여 람다 한도를 넘김). api.stock 이 진짜 죽었다면
 * 1차 시도에서 이미 확인됨.
 *
 * 두 엔드포인트가 같은 IP 에서 나가므로 IP 기준 rate limit 에는 폴백이 무력.
 * 그건 호출측에서 동시 요청 수를 줄여 예방 (api/prices 의 CHUNK).
 */
export async function fetchNaverQuote(ticker: string): Promise<NaverQuote> {
  // 초기값을 둔다 — 이 지점에 도달하는 경로는 아래 catch 뿐이지만
  // TS 의 definite-assignment 분석이 중첩 try/catch + return 을 못 따라감.
  let firstError = "unknown";
  try {
    return await fetchViaPolling(ticker);
  } catch (e1) {
    try {
      return await fetchViaApiStock(ticker);
    } catch (e2) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      firstError = `polling: ${m1} / api.stock: ${m2}`;
    }
  }

  // 재시도 전 200~500ms 랜덤 대기 — 동시에 실패한 티커들이 한꺼번에
  // 재시도해서 다시 버스트가 되는 걸 방지 (지터).
  await sleep(200 + Math.random() * 300);
  try {
    return await fetchViaPolling(ticker);
  } catch (retryErr) {
    const m = retryErr instanceof Error ? retryErr.message : String(retryErr);
    throw new Error(`네이버 실패 — 1차 ${firstError} / 재시도 ${m}`);
  }
}
