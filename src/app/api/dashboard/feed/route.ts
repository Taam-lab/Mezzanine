import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchCompanyDisclosures, fetchGoogleNews, type FeedItem } from "@/lib/companyFeed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface ComputedAlert {
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  body?: string;
  url?: string;
  date: string;
  isoDate: string;
  ticker: string;
  companyName: string;
  kind: "disclosure";
}

/**
 * 티커 -> corpCode 맵. 요청당 한 번만 조회한다.
 *
 * 이전에는 fetchDartOrNaverDisclosures 안에서 티커마다 findFirst 를 돌려
 * 13종목이면 13번의 DB 왕복이 각 티커의 DART 호출 앞에 직렬로 붙었다.
 * (DATABASE_URL 의 connection_limit=1 때문에 Promise.all 로 감싸도 실제로는
 *  순차 실행이라 그 13번이 그대로 누적된다.)
 *
 * 주의: 한 티커에 여러 포지션이 있을 수 있고, corpCode 가 채워진 행과
 * sourceDisclosureUrl 이 있는 행이 서로 다를 수 있다. 임의의 첫 행을 쓰면
 * corpCode 가 null 로 잡혀 조용히 느린 Naver 스크래핑으로 떨어지므로
 * 둘을 각각 "값이 있는 행" 기준으로 고른다.
 */
async function loadCorpCodeMap(tickers: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (tickers.length === 0) return map;
  try {
    const rows = await prisma.position.findMany({
      where: { underlyingTicker: { in: tickers }, isActive: true },
      select: { underlyingTicker: true, corpCode: true },
    });
    for (const r of rows) {
      if (r.corpCode && !map.has(r.underlyingTicker)) {
        map.set(r.underlyingTicker, r.corpCode);
      }
    }
  } catch {
    // DB 문제 → 전부 Naver 폴백
  }
  return map;
}

/**
 * 공시 심각도 판정. 접수일이 최근 며칠 이내가 아니면 알림 대상 아님 —
 * 사업보고서·반기보고서처럼 스캔에 새로 걸린 옛 공시가 매번 긴급 알림으로
 * 뜨는 걸 방지.
 */
function classifyDisclosure(
  d: FeedItem,
  todayIso: string,
  yesterdayIso: string,
): "CRITICAL" | "WARNING" | null {
  const title = d.title;
  const day = d.isoDate.slice(0, 10);

  // 접수일이 없거나 파싱 실패 → 안전하게 알림 대상 아님
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;

  // CRITICAL 대상 키워드
  const criticalKeyword =
    /사업보고서|분기보고서|반기보고서/.test(title) ||
    /(?:영업|매출|손익).{0,15}(?:실적|구조|변경)/.test(title) ||
    /영업\s*\(?잠정\)?\s*실적/.test(title) ||
    /주요경영사항|현금·현물배당결정/.test(title);

  // CRITICAL: 키워드 매칭 + 오늘/어제 접수만 (옛 공시 재알림 방지)
  if (criticalKeyword && (day === todayIso || day === yesterdayIso)) {
    return "CRITICAL";
  }

  // WARNING: 오늘/어제 접수된 나머지 공시
  if (day === todayIso || day === yesterdayIso) return "WARNING";
  return null;
}

async function fetchOneTicker(
  ticker: string,
  companyName: string,
  corpCode: string | null,
): Promise<{ news: FeedItem[]; disclosures: FeedItem[] }> {
  const [news, disclosures] = await Promise.all([
    fetchGoogleNews(ticker, companyName).catch(() => []),
    fetchCompanyDisclosures(ticker, companyName, corpCode).catch(() => []),
  ]);
  return { news, disclosures };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tickersParam = searchParams.get("tickers");
  if (!tickersParam) {
    return NextResponse.json({ news: [], disclosures: [], alerts: [] });
  }

  const entries = tickersParam
    .split(",")
    .map((chunk) => {
      const [t, name] = chunk.split(":");
      return {
        ticker: t?.trim() ?? "",
        companyName: name ? decodeURIComponent(name.trim()) : t?.trim() ?? "",
      };
    })
    .filter((e) => /^\d{6}$/.test(e.ticker))
    .slice(0, 20);

  if (entries.length === 0) {
    return NextResponse.json({ news: [], disclosures: [], alerts: [] });
  }

  // 티커별 corpCode 를 한 번에 조회 — 이전에는 티커마다 findFirst 가
  // 각 DART 호출 앞에 직렬로 붙었다.
  const corpCodeMap = await loadCorpCodeMap(entries.map((e) => e.ticker));

  const results = await Promise.all(
    entries.map((e) =>
      fetchOneTicker(e.ticker, e.companyName, corpCodeMap.get(e.ticker) ?? null),
    ),
  );

  const allNews: FeedItem[] = [];
  const allDisc: FeedItem[] = [];
  for (const r of results) {
    allNews.push(...r.news);
    allDisc.push(...r.disclosures);
  }

  allNews.sort((a, b) => (a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0));
  allDisc.sort((a, b) => (a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0));

  const now = new Date();
  const kstOffset = 9 * 60;
  const kstNow = new Date(now.getTime() + kstOffset * 60000);
  const todayIso = kstNow.toISOString().slice(0, 10);
  const yesterday = new Date(kstNow);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yesterdayIso = yesterday.toISOString().slice(0, 10);

  const alerts: ComputedAlert[] = [];
  for (const d of allDisc) {
    const sev = classifyDisclosure(d, todayIso, yesterdayIso);
    if (!sev) continue;
    alerts.push({
      severity: sev,
      title: `[${d.companyName}] ${d.title}`,
      url: d.url,
      date: d.date,
      isoDate: d.isoDate,
      ticker: d.ticker,
      companyName: d.companyName,
      kind: "disclosure",
    });
  }

  return NextResponse.json(
    {
      news: allNews.slice(0, 30),
      disclosures: allDisc.slice(0, 40),
      alerts,
    },
    {
      headers: {
        // Vercel Edge CDN 캐시: 같은 tickers 조합의 재요청은 90초간 lambda 실행 없이
        // 엣지에서 즉시 반환. stale-while-revalidate 로 만료 직후에도 이전 응답을
        // 먼저 주고 백그라운드 재검증 → 체감 로딩 0ms.
        "Cache-Control": "public, s-maxage=90, stale-while-revalidate=300",
      },
    },
  );
}
