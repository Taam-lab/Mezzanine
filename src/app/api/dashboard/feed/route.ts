import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface FeedItem {
  title: string;
  url: string;
  date: string; // YYYY-MM-DD or YYYY-MM-DD HH:mm
  source?: string;
}

interface TickerFeed {
  ticker: string;
  news: FeedItem[];
  disclosures: FeedItem[];
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
      // 헤더에 없으면 <meta charset> 파싱을 위해 우선 latin1로 훑고 다시 decode
      const sniff = new TextDecoder("latin1").decode(buf);
      const metaMatch = sniff.match(/<meta[^>]+charset=["']?([\w\-]+)/i);
      encoding = metaMatch ? metaMatch[1].toLowerCase() : "euc-kr";
    }
    try {
      return new TextDecoder(encoding).decode(buf);
    } catch {
      // 미지원 인코딩이면 utf-8 fallback
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
 * Naver Finance 종목별 뉴스: 실시간 속보 페이지 파싱.
 * https://finance.naver.com/item/news_news.naver?code={ticker}&page=1&sm=title_entity_id.basic
 *
 * HTML 구조: <table class="type5"> 안에 <tr> 마다
 *   <td class="title"><a href="/item/news_read.naver?...">제목</a></td>
 *   <td class="info">신문사</td>
 *   <td class="date">YYYY.MM.DD HH:mm</td>
 */
async function fetchNaverNews(ticker: string): Promise<FeedItem[]> {
  const url = `https://finance.naver.com/item/news_news.naver?code=${ticker}&page=1&sm=title_entity_id.basic&clusterId=`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const items: FeedItem[] = [];
  // <tr onclick="..."> 로 각 행이 감싸진 경우가 있고, 순수 <tr> 인 경우도 있음.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null && items.length < 8) {
    const row = m[1];
    if (!row.includes('class="title"')) continue;
    const titleMatch = row.match(/<td[^>]*class=["']?title["']?[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/);
    const dateMatch = row.match(/<td[^>]*class=["']?date["']?[^>]*>([\s\S]*?)<\/td>/);
    const infoMatch = row.match(/<td[^>]*class=["']?info["']?[^>]*>([\s\S]*?)<\/td>/);
    if (!titleMatch) continue;

    const href = titleMatch[1].startsWith("http")
      ? titleMatch[1]
      : `https://finance.naver.com${titleMatch[1]}`;
    const title = decodeHtmlEntities(titleMatch[2].replace(/<[^>]+>/g, "").trim());
    const date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    const info = infoMatch ? infoMatch[1].replace(/<[^>]+>/g, "").trim() : undefined;
    if (title) items.push({ title, url: href, date, source: info });
  }
  return items;
}

/**
 * Naver Finance 종목별 공시 (전자공시).
 * https://finance.naver.com/item/news_notice.naver?code={ticker}&page=1
 *
 * HTML 구조는 news와 유사. 링크가 DART로 연결됨.
 */
async function fetchNaverDisclosures(ticker: string): Promise<FeedItem[]> {
  const url = `https://finance.naver.com/item/news_notice.naver?code=${ticker}&page=1`;
  const html = await fetchHtml(url);
  if (!html) return [];

  const items: FeedItem[] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null && items.length < 8) {
    const row = m[1];
    if (!row.includes('class="title"')) continue;
    const titleMatch = row.match(/<td[^>]*class=["']?title["']?[^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/);
    const dateMatch = row.match(/<td[^>]*class=["']?date["']?[^>]*>([\s\S]*?)<\/td>/);
    if (!titleMatch) continue;

    let href = titleMatch[1];
    if (href.startsWith("/")) href = `https://finance.naver.com${href}`;
    // Naver 공시 링크는 종종 rcpNo가 파라미터로 있음 → DART 뷰어 URL 로 변환
    const rcpMatch = href.match(/rcpNo=(\d+)/i);
    if (rcpMatch) href = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpMatch[1]}`;

    const title = decodeHtmlEntities(titleMatch[2].replace(/<[^>]+>/g, "").trim());
    const date = dateMatch ? dateMatch[1].replace(/<[^>]+>/g, "").trim() : "";
    if (title) items.push({ title, url: href, date });
  }
  return items;
}

async function fetchOneTicker(ticker: string): Promise<TickerFeed> {
  const [news, disclosures] = await Promise.all([
    fetchNaverNews(ticker).catch(() => []),
    fetchNaverDisclosures(ticker).catch(() => []),
  ]);
  return { ticker, news, disclosures };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const tickersParam = searchParams.get("tickers");
  if (!tickersParam) {
    return NextResponse.json({ feeds: [] });
  }

  const tickers = tickersParam
    .split(",")
    .map((t) => t.trim())
    .filter((t) => /^\d{6}$/.test(t))
    .slice(0, 20); // 안전 상한

  if (tickers.length === 0) return NextResponse.json({ feeds: [] });

  // 티커별 병렬 (뉴스+공시 각 2 요청, 총 tickers × 2 요청). 상한 20 * 2 = 40.
  const feeds = await Promise.all(tickers.map((t) => fetchOneTicker(t)));

  return NextResponse.json({ feeds });
}
