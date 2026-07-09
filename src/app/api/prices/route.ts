import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/prices?tickers=A,B,C
 * 요청한 종목코드들의 최신 스냅샷을 {티커: 시세} 맵으로 반환.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("tickers") ?? "";
  const tickers = Array.from(
    new Set(
      raw
        .split(",")
        .map((t) => t.trim())
        .filter((t) => /^\d{6}$/.test(t)),
    ),
  );

  if (tickers.length === 0) {
    return NextResponse.json({ error: "tickers 파라미터가 필요합니다." }, { status: 400 });
  }
  if (tickers.length > 100) {
    return NextResponse.json({ error: "한 번에 최대 100개까지 조회 가능합니다." }, { status: 400 });
  }

  // 각 종목별로 최신 스냅샷 1건씩 조회
  // (PriceSnapshot에는 종목코드 컬럼이 없으므로 positions 조인으로 접근)
  const rows = await prisma.$queryRaw<
    Array<{ ticker: string; price: number; change_rate: number | null; snapshot_at: Date; source: string | null }>
  >`
    SELECT DISTINCT ON (p.underlying_ticker)
      p.underlying_ticker AS ticker,
      ps.price AS price,
      ps.change_rate AS change_rate,
      ps.snapshot_at AS snapshot_at,
      ps.source AS source
    FROM price_snapshots ps
    JOIN positions p ON p.id = ps.position_id
    WHERE p.underlying_ticker = ANY(${tickers}) AND p.is_active = TRUE
    ORDER BY p.underlying_ticker, ps.snapshot_at DESC
  `;

  const map: Record<string, { price: number; changeRate: number; tradedAt: string; source: string | null }> = {};
  for (const row of rows) {
    map[row.ticker] = {
      price: row.price,
      changeRate: row.change_rate ?? 0,
      tradedAt: row.snapshot_at.toISOString(),
      source: row.source,
    };
  }

  return NextResponse.json({ quotes: map, count: rows.length });
}
