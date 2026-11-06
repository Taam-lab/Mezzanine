import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchNaverQuote } from "@/lib/naverPrice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: { ticker: string } },
) {
  // save=false: 시세만 반환하고 스냅샷은 쓰지 않는다. 상세 화면의 60초 자동 갱신이
  // 매번 스냅샷을 쌓아 탭 하나에 하루 수백 행씩 늘던 것을 막는다.
  const skipSave = new URL(req.url).searchParams.get("save") === "false";
  const ticker = params.ticker?.trim();
  if (!ticker || !/^\d{6}$/.test(ticker)) {
    return NextResponse.json(
      { error: "6자리 종목코드가 필요합니다." },
      { status: 400 },
    );
  }

  try {
    const quote = await fetchNaverQuote(ticker);
    if (skipSave) return NextResponse.json({ ...quote, savedFor: 0 });

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

    return NextResponse.json({ ...quote, savedFor: positions.length });
  } catch (err) {
    console.error("[prices]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `네이버 시세 조회 실패: ${detail.slice(0, 200)}` },
      { status: 502 },
    );
  }
}
