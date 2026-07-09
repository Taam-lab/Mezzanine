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
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: NAVER_HEADERS });
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
  const res = await fetch(url, { signal: AbortSignal.timeout(4000), headers: NAVER_HEADERS });
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

/**
 * 네이버 실시간 시세. 두 엔드포인트를 순차 시도.
 * 하나가 죽어도 다른 하나로 커버되어 훨씬 안정적.
 */
export async function fetchNaverQuote(ticker: string): Promise<NaverQuote> {
  try {
    return await fetchViaPolling(ticker);
  } catch (e1) {
    try {
      return await fetchViaApiStock(ticker);
    } catch (e2) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`네이버 두 엔드포인트 모두 실패 — polling: ${m1} / api.stock: ${m2}`);
    }
  }
}
