import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchQuote } from "@/lib/checkPrice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const quote = await fetchQuote(ticker);

    const positions = await prisma.position.findMany({
      where: { underlyingTicker: ticker, isActive: true },
      select: { id: true },
    });

    if (positions.length > 0) {
      const marketCap = quote.marketCap !== undefined ? BigInt(Math.floor(quote.marketCap)) : null;
      const volume = quote.volume !== undefined ? BigInt(Math.floor(quote.volume)) : null;

      await prisma.priceSnapshot.createMany({
        data: positions.map((p: { id: string }) => ({
          positionId: p.id,
          price: quote.price,
          changeRate: quote.changeRate,
          volume,
          marketCap,
          source: "check",
        })),
      });
    }

    return NextResponse.json({ ...quote, savedFor: positions.length });
  } catch (err) {
    console.error("[prices]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `CHECK 시세 조회 실패: ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }
}
