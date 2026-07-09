import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchQuote, type Quote } from "@/lib/checkPrice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/prices?tickers=A,B,C
 * CHECK API로 실시간 시세를 병렬 조회. 성공한 종목은 스냅샷 저장.
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

  // 8개씩 청크로 병렬 조회 (외부 API rate limit 대비)
  const CHUNK = 8;
  const results: Array<Quote | { ticker: string; error: string }> = [];
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const settled = await Promise.allSettled(chunk.map((t) => fetchQuote(t)));
    settled.forEach((r, idx) => {
      const t = chunk[idx];
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        results.push({ ticker: t, error: msg.slice(0, 150) });
      }
    });
  }

  const successful = results.filter((r): r is Quote => "price" in r);
  if (successful.length > 0) {
    const tickerSet = successful.map((q) => q.ticker);
    const positions = await prisma.position.findMany({
      where: { underlyingTicker: { in: tickerSet }, isActive: true },
      select: { id: true, underlyingTicker: true },
    });
    const byTicker = new Map<string, Quote>(successful.map((q) => [q.ticker, q]));

    interface SnapshotRow {
      positionId: string;
      price: number;
      changeRate: number;
      volume: bigint | null;
      marketCap: bigint | null;
      source: string;
    }
    const snapshots: SnapshotRow[] = [];
    for (const p of positions as Array<{ id: string; underlyingTicker: string }>) {
      const q = byTicker.get(p.underlyingTicker);
      if (!q) continue;
      snapshots.push({
        positionId: p.id,
        price: q.price,
        changeRate: q.changeRate,
        volume: q.volume !== undefined ? BigInt(Math.floor(q.volume)) : null,
        marketCap: q.marketCap !== undefined ? BigInt(Math.floor(q.marketCap)) : null,
        source: "check",
      });
    }
    if (snapshots.length > 0) {
      await prisma.priceSnapshot.createMany({ data: snapshots });
    }
  }

  const map: Record<string, Quote | { error: string }> = {};
  for (const r of results) {
    if ("price" in r) {
      map[r.ticker] = r;
    } else {
      map[r.ticker] = { error: r.error };
    }
  }
  return NextResponse.json({ quotes: map, count: successful.length });
}
