import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchNaverQuote, type NaverQuote } from "@/lib/naverPrice";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/prices?tickers=A,B,C
 * 네이버 실시간 시세를 병렬로 조회해 반환.
 * 조회에 성공한 종목의 스냅샷도 DB에 저장.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("tickers") ?? "";
  const skipSave = searchParams.get("save") === "false";
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

  // 네이버는 병렬 요청에 관대함. 15개 이하는 한 번에 다 던져도 문제없음.
  const CHUNK = 15;
  const results: Array<NaverQuote | { ticker: string; error: string }> = [];
  for (let i = 0; i < tickers.length; i += CHUNK) {
    const chunk = tickers.slice(i, i + CHUNK);
    const settled = await Promise.allSettled(chunk.map((t) => fetchNaverQuote(t)));
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

  // 성공한 종목에 대해 스냅샷 저장 (활성 포지션이 있는 것만)
  // 대시보드처럼 반복 조회하는 곳은 save=false로 DB 쓰기 스킵 (응답 시간 절반)
  const successful = results.filter((r): r is NaverQuote => "price" in r);
  if (successful.length > 0 && !skipSave) {
    const tickerSet = successful.map((q) => q.ticker);
    const positions = await prisma.position.findMany({
      where: { underlyingTicker: { in: tickerSet }, isActive: true },
      select: { id: true, underlyingTicker: true },
    });
    const byTicker = new Map<string, NaverQuote>(successful.map((q) => [q.ticker, q]));
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
        marketCap: q.marketCap !== undefined ? BigInt(Math.floor(q.marketCap * 100_000_000)) : null,
        source: "naver",
      });
    }
    if (snapshots.length > 0) {
      await prisma.priceSnapshot.createMany({ data: snapshots });
    }
  }

  // 종목코드 → 결과 매핑으로 반환
  const map: Record<string, NaverQuote | { error: string }> = {};
  for (const r of results) {
    if ("price" in r) {
      map[r.ticker] = r;
    } else {
      map[r.ticker] = { error: r.error };
    }
  }
  return NextResponse.json({ quotes: map, count: successful.length });
}
