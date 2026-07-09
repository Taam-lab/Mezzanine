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

/**
 * 네이버 금융 실시간 시세 (JSON polling 엔드포인트)
 */
export async function fetchNaverQuote(ticker: string): Promise<NaverQuote> {
  const url = `https://polling.finance.naver.com/api/realtime/domestic/stock/${ticker}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Referer: "https://finance.naver.com/",
    },
  });
  if (!res.ok) throw new Error(`Naver HTTP ${res.status}`);
  const data = (await res.json()) as NaverPollingResponse;
  const row = data.datas?.[0];
  if (!row) throw new Error("네이버 응답에 데이터 없음");

  const price = toNum(row.closePrice);
  if (price === undefined) throw new Error("현재가 파싱 실패");

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
