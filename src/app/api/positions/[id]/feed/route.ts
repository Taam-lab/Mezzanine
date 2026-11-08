import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchCompanyDisclosures, fetchGoogleNews } from "@/lib/companyFeed";
import { classifyDisclosureTitle } from "@/lib/disclosureSeverity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

/** 상세 화면 공시 타임라인 조회 범위 */
const DISCLOSURE_DAYS = 180;
const DISCLOSURE_LIMIT = 40;
const NEWS_LIMIT = 15;

/**
 * GET /api/positions/[id]/feed — 종목 상세의 공시 타임라인·뉴스 피드용 실시간 조회.
 *
 * 상세 화면은 그동안 DB 의 disclosures / news_items 만 그렸다. 그런데 disclosures 에는
 * 전환가액 조정 공시(process-adjustments)와 워커가 그날그날 넣는 공시만 들어가고,
 * news_items 는 쓰는 곳이 아예 없어서 두 카드가 거의 항상 "없음"이었다.
 * 대시보드의 "기초자산 최근 공시·뉴스"와 같은 출처(DART → 네이버 폴백, Google News)
 * 에서 이 기업 것만 더 긴 기간으로 받아 온다. DB 행과의 병합은 화면에서 한다.
 *
 * 응답은 대시보드 피드처럼 엣지에서 90초 캐시 (인증은 그 앞의 미들웨어가 막는다).
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const position = await prisma.position.findUnique({
    where: { id: params.id },
    select: { underlyingTicker: true, underlyingCompanyName: true, corpCode: true },
  });
  if (!position) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  const ticker = position.underlyingTicker;
  if (!/^\d{6}$/.test(ticker)) {
    return NextResponse.json({ disclosures: [], news: [] });
  }

  // corp_code 가 이 행에는 없고 같은 티커의 다른 포지션에만 있을 수 있다.
  let corpCode = position.corpCode;
  if (!corpCode) {
    const sibling = await prisma.position.findFirst({
      where: { underlyingTicker: ticker, corpCode: { not: null } },
      select: { corpCode: true },
    });
    corpCode = sibling?.corpCode ?? null;
  }

  const name = position.underlyingCompanyName;
  const [disclosures, news] = await Promise.all([
    fetchCompanyDisclosures(ticker, name, corpCode, {
      days: DISCLOSURE_DAYS,
      limit: DISCLOSURE_LIMIT,
    }).catch(() => []),
    fetchGoogleNews(ticker, name, NEWS_LIMIT).catch(() => []),
  ]);

  return NextResponse.json(
    {
      disclosures: disclosures.map((d) => ({
        title: d.title,
        url: d.url,
        isoDate: d.isoDate,
        rcpNo: d.rcpNo ?? null,
        severity: classifyDisclosureTitle(d.title),
      })),
      news: news.map((n) => ({
        title: n.title,
        url: n.url,
        date: n.date,
        isoDate: n.isoDate,
        source: n.source ?? null,
      })),
    },
    {
      headers: { "Cache-Control": "public, s-maxage=90, stale-while-revalidate=300" },
    },
  );
}
