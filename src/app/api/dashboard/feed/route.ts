import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface FeedItem {
  title: string;
  url: string;
  date: string; // 표시용 원본 (YYYY.MM.DD HH:mm 또는 YYYY.MM.DD)
  isoDate: string; // 정렬용 (YYYY-MM-DD 또는 YYYY-MM-DDTHH:mm)
  source?: string;
  ticker: string;
  companyName: string;
}

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
 * Naver Finance는 응답이 EUC-KR인 페이지가 있고 UTF-8인 페이지가 있음.
 * Content-Type 헤더의 charset을 먼저 보고 없으면 EUC-KR로 시도.
 */
async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "";
    const charsetMatch = ct.match(/charset=([\w\-]+)/i);
    let encoding = charsetMatch ? charsetMatch[1].toLowerCase() : "";
    if (!encoding) {
      const sniff = new TextDecoder("latin1").decode(buf);
      const metaMatch = sniff.match(/<meta[^>]+charset=["']?([\w\-]+)/i);
      encoding = metaMatch ? metaMatch[1].toLowerCase() : "euc-kr";
    }
    try {
      return new TextDecoder(encoding).decode(buf);
    } catch {
      return new TextDecoder("utf-8").decode(buf);
    }
  } catch {
    return null;
  }
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

/**
 * "2026.08.19 15:23" 또는 "2026.08.19" 형태를 정렬용 ISO로 변환.
 * 실패 시 원본 반환.
 */
function toIso(display: string): string {
  const m = display.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return display;
  const [, y, mo, d, h, mi] = m;
  const pad = (v: string) => v.padStart(2, "0");
  return `${y}-${pad(mo)}-${pad(d)}${h ? `T${pad(h)}:${mi}` : ""}`;
}

/**
 * Naver Finance 종목별 뉴스 스크래핑.
 * https://finance.naver.com/item/news_news.naver?code={ticker}&page=1
 */
async function fetchNaverNews(
  ticker: string,
  companyName: string,
): Promise<FeedItem[]> {
  const url = `https://finance.naver.com/item/news_news.naver?code=${ticker}&page=1&sm=title_entity_id.basic&clusterId=`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const items: FeedItem[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null && items.length < 8) {
    const row = m[1];
    if (!row.includes('class="title"')) continue;
    const titleMatch = row.match(
      /<td[^>]*class=["']?title["']?[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/,
    );
    const dateMatch = row.match(/<td[^>]*class=["']?date["']?[^>]*>([\s\S]*?)<\/td>/);
    const infoMatch = row.match(/<td[^>]*class=["']?info["']?[^>]*>([\s\S]*?)<\/td>/);
    if (!titleMatch) continue;

    const href = titleMatch[1].startsWith("http")
      ? titleMatch[1]
      : `https://finance.naver.com${titleMatch[1]}`;
    const title = decodeHtmlEntities(titleMatch[2].replace(/<[^>]+>/g, "").trim());
    const date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const info = infoMatch ? infoMatch[1].replace(/<[^>]+>/g, "").trim() : undefined;
    if (title) {
      items.push({
        title,
        url: href,
        date,
        isoDate: toIso(date),
        source: info,
        ticker,
        companyName,
      });
    }
  }
  return items;
}

/**
 * Naver Finance 종목별 공시 (전자공시).
 * https://finance.naver.com/item/news_notice.naver?code={ticker}&page=1
 */
async function fetchNaverDisclosures(
  ticker: string,
  companyName: string,
): Promise<FeedItem[]> {
  const url = `https://finance.naver.com/item/news_notice.naver?code=${ticker}&page=1`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const items: FeedItem[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null && items.length < 12) {
    const row = m[1];
    if (!row.includes('class="title"')) continue;
    const titleMatch = row.match(
      /<td[^>]*class=["']?title["']?[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/,
    );
    const dateMatch = row.match(/<td[^>]*class=["']?date["']?[^>]*>([\s\S]*?)<\/td>/);
    if (!titleMatch) continue;

    let href = titleMatch[1];
    if (href.startsWith("/")) href = `https://finance.naver.com${href}`;
    const rcpMatch = href.match(/rcpNo=(\d+)/i);
    if (rcpMatch) href = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpMatch[1]}`;

    const title = decodeHtmlEntities(titleMatch[2].replace(/<[^>]+>/g, "").trim());
    const date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    if (title) {
      items.push({
        title,
        url: href,
        date,
        isoDate: toIso(date),
        ticker,
        companyName,
      });
    }
  }
  return items;
}

/**
 * 공시 제목에서 알림 심각도 판정.
 *  - CRITICAL: 실적/영업실적/영업(잠정)실적, 사업보고서, 분기보고서, 반기보고서, 매출액/손익구조 변경
 *  - WARNING: 조회일 기준 전일/당일 공시 (그 외)
 *  - null: 알림 대상 아님
 */
function classifyDisclosure(
  d: FeedItem,
  todayIso: string,
  yesterdayIso: string,
): "CRITICAL" | "WARNING" | null {
  const title = d.title;
  const critical =
    /사업보고서|분기보고서|반기보고서/.test(title) ||
    /(?:영업|매출|손익).{0,15}(?:실적|구조|변경)/.test(title) ||
    /영업\s*\(?잠정\)?\s*실적/.test(title) ||
    /주요경영사항|현금·현물배당결정|주요사항보고서.*매출/.test(title);
  if (critical) return "CRITICAL";
  const day = d.isoDate.slice(0, 10);
  if (day === todayIso || day === yesterdayIso) return "WARNING";
  return null;
}

async function fetchOneTicker(
  ticker: string,
  companyName: string,
): Promise<{ news: FeedItem[]; disclosures: FeedItem[] }> {
  const [news, disclosures] = await Promise.all([
    fetchNaverNews(ticker, companyName).catch(() => []),
    fetchNaverDisclosures(ticker, companyName).catch(() => []),
  ]);
  return { news, disclosures };
}

/**
 * GET /api/dashboard/feed?tickers=005930:삼성전자,000660:SK하이닉스
 * ticker:companyName 쌍으로 넘기고, 뉴스/공시를 flat + date desc 로 반환.
 * 공시 기반 실시간 알림도 계산해서 함께 반환 (가격 알림은 클라이언트에서 계산).
 */
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
      return { ticker: t?.trim() ?? "", companyName: name?.trim() ?? t?.trim() ?? "" };
    })
    .filter((e) => /^\d{6}$/.test(e.ticker))
    .slice(0, 20);

  if (entries.length === 0) {
    return NextResponse.json({ news: [], disclosures: [], alerts: [] });
  }

  const results = await Promise.all(
    entries.map((e) => fetchOneTicker(e.ticker, e.companyName)),
  );

  const allNews: FeedItem[] = [];
  const allDisc: FeedItem[] = [];
  for (const r of results) {
    allNews.push(...r.news);
    allDisc.push(...r.disclosures);
  }

  allNews.sort((a, b) => (a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0));
  allDisc.sort((a, b) => (a.isoDate < b.isoDate ? 1 : a.isoDate > b.isoDate ? -1 : 0));

  // 알림 계산: 오늘/어제 (KST 기준)
  const now = new Date();
  const kstOffset = 9 * 60; // KST = UTC+9
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

  return NextResponse.json({
    news: allNews.slice(0, 30),
    disclosures: allDisc.slice(0, 40),
    alerts,
  });
}
