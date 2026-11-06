import { NextRequest, NextResponse } from "next/server";
import { fetchNaverQuote, type NaverQuote } from "@/lib/naverPrice";
import { getDashboardData } from "@/lib/dashboardQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/**
 * GET /api/dashboard/init?tickers=005930,000660
 *
 * 대시보드 첫 로딩용 통합 엔드포인트. 서버에서 병렬 실행해 클라이언트 왕복을 줄이고
 * lambda 콜드스타트를 3번 → 1번으로 줄인다.
 *
 * tickers 파라미터가 있으면 (클라이언트 sessionStorage 캐시에서 온 값):
 *   DB 배치(positions + alerts) + Naver 시세 병렬 — wall clock = 가장 느린 하나
 *
 * 없으면 (진짜 최초 방문):
 *   positions + alert 병렬 → 그 다음 그 결과의 티커로 시세
 *
 * 뉴스/공시 feed는 여기서 안 함 — /api/dashboard/feed 별도 (백그라운드에서 별개로 호출).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hintedTickersParam = searchParams.get("tickers");
  const hintedTickers = hintedTickersParam
    ? Array.from(
        new Set(
          hintedTickersParam
            .split(",")
            .map((t) => t.trim())
            .filter((t) => /^\d{6}$/.test(t)),
        ),
      )
    : [];

  // DB(활성 종목 + 최근 알림, 배치 1회)와 힌트 티커의 네이버 시세를 병렬로.
  // 대시보드 서버 컴포넌트와 같은 조회를 공유한다 (src/lib/dashboardQuery.ts).
  // 대시보드는 읽음 상태를 안 쓰므로 getDefaultUserId()(upsert)·userStatuses 조인은 뺐다.
  const [{ positions, alerts: alertsRaw }, hintedQuotes] = await Promise.all([
    getDashboardData(20),
    hintedTickers.length > 0
      ? Promise.allSettled(hintedTickers.map((t) => fetchNaverQuote(t)))
      : Promise.resolve([]),
  ]);

  // 실제 활성 종목의 티커 목록
  const actualTickers = Array.from(
    new Set(
      positions
        .filter((p) => /^\d{6}$/.test(p.underlyingTicker))
        .map((p) => p.underlyingTicker),
    ),
  );

  // 힌트 티커와 실제 티커가 일치하지 않으면 (신규 등록/삭제) 누락된 것만 추가 조회
  const hintedSet = new Set(hintedTickers);
  const missingTickers = actualTickers.filter((t) => !hintedSet.has(t));

  // 힌트 결과 → 맵
  const quoteMap: Record<string, { price?: number; changeRate?: number; error?: string }> = {};
  hintedQuotes.forEach((r, i) => {
    const t = hintedTickers[i];
    if (!t) return;
    if (r.status === "fulfilled") {
      const q = r.value as NaverQuote;
      quoteMap[t] = { price: q.price, changeRate: q.changeRate };
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      quoteMap[t] = { error: msg.slice(0, 150) };
    }
  });

  // 힌트에 없던 실제 티커 추가 조회 (병렬)
  if (missingTickers.length > 0) {
    const extra = await Promise.allSettled(missingTickers.map((t) => fetchNaverQuote(t)));
    extra.forEach((r, i) => {
      const t = missingTickers[i];
      if (r.status === "fulfilled") {
        const q = r.value as NaverQuote;
        quoteMap[t] = { price: q.price, changeRate: q.changeRate };
      } else {
        const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
        quoteMap[t] = { error: msg.slice(0, 150) };
      }
    });
  }

  return NextResponse.json({
    positions,
    alerts: alertsRaw,
    quotes: quoteMap,
    tickers: actualTickers,
  });
}
