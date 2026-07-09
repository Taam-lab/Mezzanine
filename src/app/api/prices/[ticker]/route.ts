import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/prices/[ticker]
 * DB에 저장된 최신 PriceSnapshot 반환.
 * (CHECK API는 고정 IP 워커가 폴링해서 스냅샷 저장 → 웹은 DB만 읽음)
 */
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

  const snapshot = await prisma.priceSnapshot.findFirst({
    where: { position: { underlyingTicker: ticker, isActive: true } },
    orderBy: { snapshotAt: "desc" },
    select: { price: true, changeRate: true, snapshotAt: true, source: true },
  });

  if (!snapshot) {
    return NextResponse.json(
      { error: "저장된 시세 스냅샷이 없습니다.", ticker },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ticker,
    price: snapshot.price,
    changeRate: snapshot.changeRate ?? 0,
    tradedAt: snapshot.snapshotAt.toISOString(),
    source: snapshot.source,
  });
}
