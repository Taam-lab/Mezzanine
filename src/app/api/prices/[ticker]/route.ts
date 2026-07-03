import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function toNum(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 네이버 금융 실시간 시세 (JSON polling 엔드포인트)
 * HTML 스크래핑보다 안정적이고 응답도 작음.
 */
async function fetchNaverPrice(ticker: string) {
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
    price,
    changeAmount: toNum(row.compareToPreviousClosePrice) ?? 0,
    changeRate: toNum(row.fluctuationsRatio) ?? 0,
    volume: toNum(row.accumulatedTradingVolume),
    marketCap: toNum(row.marketValue), // 억원 단위
    stockName: row.stockName,
    tradedAt: row.localTradedAt,
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { ticker: string } },
) {
  const ticker = params.ticker?.trim();
  if (!ticker || !/^\d{6}$/.test(ticker)) {
    return NextResponse.json(
      { error: "6자리 종목코드가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const quote = await fetchNaverPrice(ticker);

    // 해당 종목을 참조하는 활성 포지션에 스냅샷 저장 (여러 포지션이 같은 종목 참조 가능)
    const positions = await prisma.position.findMany({
      where: { underlyingTicker: ticker, isActive: true },
      select: { id: true },
    });

    if (positions.length > 0) {
      const marketCapWon =
        quote.marketCap !== undefined ? BigInt(Math.floor(quote.marketCap * 100_000_000)) : null;
      const volumeBig = quote.volume !== undefined ? BigInt(Math.floor(quote.volume)) : null;

      await prisma.priceSnapshot.createMany({
        data: positions.map((p: { id: string }) => ({
          positionId: p.id,
          price: quote.price,
          changeRate: quote.changeRate,
          volume: volumeBig,
          marketCap: marketCapWon,
          source: "naver",
        })),
      });
    }

    return NextResponse.json({
      ticker,
      ...quote,
      savedFor: positions.length,
    });
  } catch (err) {
    console.error("[prices]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `네이버 시세 조회 실패: ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }
}
