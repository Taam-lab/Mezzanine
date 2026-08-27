import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  fetchDartDisclosuresByCorpCode,
  resolveCorpCodeByRcpNo,
} from "@/lib/dartDisclosures";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 15;

interface FeedItem {
  title: string;
  url: string;
  date: string;
  isoDate: string;
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

// ─────────────────────────────────────────────
// 캐시: 티커별 90초 in-memory (Naver / Google 서버 반복 히트 회피 + 재로딩 즉시 반환)
// ─────────────────────────────────────────────
interface CacheEntry<T> {
  ts: number;
  value: T;
}
const CACHE_TTL_MS = 90_000;
const newsCache = new Map<string, CacheEntry<FeedItem[]>>();
const disclosureCache = new Map<string, CacheEntry<FeedItem[]>>();

function getCached<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    map.delete(key);
    return null;
  }
  return hit.value;
}

function setCached<T>(map: Map<string, CacheEntry<T>>, key: string, value: T) {
  map.set(key, { ts: Date.now(), value });
}

// ─────────────────────────────────────────────
// HTTP fetch — 짧은 타임아웃, 인코딩 자동 감지
// ─────────────────────────────────────────────
async function fetchText(url: string, timeout = 3500): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml",
      },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "";
    const charsetMatch = ct.match(/charset=([\w\-]+)/i);
    let encoding = charsetMatch ? charsetMatch[1].toLowerCase() : "";
    if (!encoding) {
      const sniff = new TextDecoder("latin1").decode(buf.slice(0, 2048));
      const metaMatch =
        sniff.match(/<meta[^>]+charset=["']?([\w\-]+)/i) ??
        sniff.match(/encoding=["']([\w\-]+)/i);
      encoding = metaMatch ? metaMatch[1].toLowerCase() : "utf-8";
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
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/**
 * "2026.08.19 15:23" → ISO (KST 로 저장된 원본 그대로)
 * "Wed, 19 Aug 2026 15:23:00 GMT" → ISO (UTC → KST 로 변환)
 *
 * Google News pubDate가 GMT 로 오면 UTC 그대로 sort/display 하면 9시간 차이가 나서
 * 뉴스 시간이 이상하게 보인다. UTC epoch로 파싱 후 +9h shift 해서 KST 문자열 반환.
 */
function toIsoLoose(display: string): string {
  const kr = display.match(/(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (kr) {
    const [, y, mo, d, h, mi] = kr;
    const pad = (v: string) => v.padStart(2, "0");
    return `${y}-${pad(mo)}-${pad(d)}${h ? `T${pad(h)}:${mi}` : ""}`;
  }
  const t = Date.parse(display);
  if (!Number.isNaN(t)) {
    const kst = new Date(t + 9 * 3600_000);
    return kst.toISOString().slice(0, 16); // YYYY-MM-DDTHH:mm (KST wall clock)
  }
  return display;
}

/** ISO 문자열이 오늘/어제인지에 따라 "N분 전" / "N시간 전" / "M/D HH:mm" 로 표시.
 * KST 기준으로 계산 (isoDate는 KST wall-clock 저장).
 */
function formatDisplayFromIso(iso: string): string {
  const m = iso.match(/(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return iso;
  const [, y, mo, d, h, mi] = m;
  return h ? `${y}.${mo}.${d} ${h}:${mi}` : `${y}.${mo}.${d}`;
}

// ─────────────────────────────────────────────
// 뉴스: Google News RSS (UTF-8, XML — 인코딩 안전, 안정적)
// ─────────────────────────────────────────────
async function fetchGoogleNews(ticker: string, companyName: string): Promise<FeedItem[]> {
  const cacheKey = `news:${ticker}`;
  const hit = getCached(newsCache, cacheKey);
  if (hit) return hit;

  // 회사명 + 종목코드 + 주식 키워드로 노이즈 감소
  const q = encodeURIComponent(`${companyName} 주식`);
  const url = `https://news.google.com/rss/search?q=${q}&hl=ko&gl=KR&ceid=KR:ko`;
  const xml = await fetchText(url, 4000);
  if (!xml) {
    setCached(newsCache, cacheKey, []);
    return [];
  }

  const items: FeedItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < 8) {
    const inner = m[1];
    const titleMatch = inner.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
    const linkMatch = inner.match(/<link>([\s\S]*?)<\/link>/);
    const pubMatch = inner.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = inner.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    if (!titleMatch || !linkMatch) continue;

    const rawTitle = decodeHtmlEntities(titleMatch[1].trim());
    // Google News 제목은 "제목 - 언론사" 형식 — 언론사 분리
    let title = rawTitle;
    let source = sourceMatch ? decodeHtmlEntities(sourceMatch[1].trim()) : undefined;
    const sep = rawTitle.lastIndexOf(" - ");
    if (sep !== -1 && !source) {
      title = rawTitle.slice(0, sep).trim();
      source = rawTitle.slice(sep + 3).trim();
    } else if (sep !== -1) {
      title = rawTitle.slice(0, sep).trim();
    }

    const link = linkMatch[1].trim();
    const iso = pubMatch ? toIsoLoose(pubMatch[1].trim()) : "";
    items.push({
      title,
      url: link,
      date: formatDisplayFromIso(iso) || pubMatch?.[1] || "",
      isoDate: iso,
      source,
      ticker,
      companyName,
    });
  }

  setCached(newsCache, cacheKey, items);
  return items;
}

// ─────────────────────────────────────────────
// 공시: DART OpenAPI 우선 (corp_code 필요), 없으면 Naver 폴백
// ─────────────────────────────────────────────

/** DART list.json 기반. 티커의 corp_code 를 DB 에서 조회, 없으면 Naver 폴백. */
async function fetchDartOrNaverDisclosures(
  ticker: string,
  companyName: string,
): Promise<FeedItem[]> {
  const cacheKey = `disc:${ticker}`;
  const hit = getCached(disclosureCache, cacheKey);
  if (hit) return hit;

  const apiKey = process.env.DART_API_KEY;
  if (apiKey) {
    // 해당 티커의 활성 포지션 중 하나에서 corp_code 조회
    let corpCode: string | null = null;
    try {
      const pos = await prisma.position.findFirst({
        where: { underlyingTicker: ticker, isActive: true, corpCode: { not: null } },
        select: { corpCode: true },
      });
      corpCode = pos?.corpCode ?? null;

      // 없으면 sourceDisclosureUrl 로 resolve + 저장
      if (!corpCode) {
        const posWithUrl = await prisma.position.findFirst({
          where: {
            underlyingTicker: ticker,
            isActive: true,
            sourceDisclosureUrl: { not: null },
          },
          select: { id: true, sourceDisclosureUrl: true },
        });
        if (posWithUrl?.sourceDisclosureUrl) {
          const rcpMatch = posWithUrl.sourceDisclosureUrl.match(/rcpNo=(\d+)/i);
          if (rcpMatch) {
            const resolved = await resolveCorpCodeByRcpNo(rcpMatch[1], apiKey);
            if (resolved) {
              corpCode = resolved;
              await prisma.position.updateMany({
                where: { underlyingTicker: ticker, corpCode: null },
                data: { corpCode: resolved },
              });
            }
          }
        }
      }
    } catch {
      // DB 문제 → Naver 폴백
    }

    if (corpCode) {
      const dart = await fetchDartDisclosuresByCorpCode(corpCode, apiKey, 30);
      if (dart.length > 0) {
        const items: FeedItem[] = dart.slice(0, 12).map((d) => ({
          title: d.title,
          url: d.url,
          date: d.date,
          isoDate: d.isoDate,
          ticker,
          companyName,
        }));
        setCached(disclosureCache, cacheKey, items);
        return items;
      }
    }
  }

  // Naver 폴백
  const url = `https://finance.naver.com/item/news_notice.naver?code=${ticker}&page=1`;
  const html = await fetchText(url, 4000);
  if (!html) {
    setCached(disclosureCache, cacheKey, []);
    return [];
  }

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
        isoDate: toIsoLoose(date),
        ticker,
        companyName,
      });
    }
  }

  setCached(disclosureCache, cacheKey, items);
  return items;
}

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
    /주요경영사항|현금·현물배당결정/.test(title);
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
    fetchGoogleNews(ticker, companyName).catch(() => []),
    fetchDartOrNaverDisclosures(ticker, companyName).catch(() => []),
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

  return NextResponse.json({
    news: allNews.slice(0, 30),
    disclosures: allDisc.slice(0, 40),
    alerts,
  });
}
