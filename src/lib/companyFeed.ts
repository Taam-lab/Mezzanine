import { fetchDartDisclosuresByCorpCode } from "@/lib/dartDisclosures";

/**
 * 기업별 뉴스·공시 외부 조회 (Google News RSS, DART OpenAPI, 네이버 금융 폴백).
 *
 * 대시보드 피드(/api/dashboard/feed)와 종목 상세 피드(/api/positions/[id]/feed)가
 * 공유한다. DB 를 거치지 않는 실시간 조회라 페이지 서버 렌더 경로에서는 부르지 않고,
 * 화면이 뜬 뒤 클라이언트가 API 로 받아 간다.
 */

export interface FeedItem {
  title: string;
  url: string;
  date: string;
  isoDate: string;
  source?: string;
  ticker: string;
  companyName: string;
  /** DART 접수번호 — 공시 항목만. 중복 제거용. */
  rcpNo?: string;
}

// ─────────────────────────────────────────────
// 캐시: 티커·조회범위별 90초 in-memory (Naver / Google 서버 반복 히트 회피 + 재로딩 즉시 반환)
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
export async function fetchGoogleNews(
  ticker: string,
  companyName: string,
  limit = 8,
): Promise<FeedItem[]> {
  const cacheKey = `news:${ticker}:${limit}`;
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
  while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
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

/**
 * 기업 공시 목록 (최신순). DART list.json 우선, corpCode 가 없거나 DART 가 빈 결과면
 * 네이버 금융 공시 목록 1페이지로 폴백. corpCode 는 호출측이 미리 조회해 넘긴다.
 *
 * days: DART 조회 기간 (네이버 폴백은 기간 지정 없이 최근 1페이지).
 * limit: 최대 건수.
 */
export async function fetchCompanyDisclosures(
  ticker: string,
  companyName: string,
  corpCode: string | null,
  { days = 30, limit = 12 }: { days?: number; limit?: number } = {},
): Promise<FeedItem[]> {
  const cacheKey = `disc:${ticker}:${days}:${limit}`;
  const hit = getCached(disclosureCache, cacheKey);
  if (hit) return hit;

  const apiKey = process.env.DART_API_KEY;
  if (apiKey) {
    // corpCode 가 아직 없는 레거시 행은 그대로 Naver 폴백으로 떨어진다.
    // resolveCorpCodeByRcpNo 백필을 여기서 돌리면 DART 페이지네이션 탐색이
    // 페이지 로드를 막으므로, 백필은 등록 시점(parse-disclosure)과
    // 스케줄 작업에 맡긴다.
    if (corpCode) {
      const dart = await fetchDartDisclosuresByCorpCode(corpCode, apiKey, days);
      if (dart.length > 0) {
        const items: FeedItem[] = dart.slice(0, limit).map((d) => ({
          title: d.title,
          url: d.url,
          date: d.date,
          isoDate: d.isoDate,
          ticker,
          companyName,
          rcpNo: d.rcpNo,
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
  while ((m = rowRe.exec(html)) !== null && items.length < limit) {
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
        rcpNo: rcpMatch?.[1],
      });
    }
  }

  setCached(disclosureCache, cacheKey, items);
  return items;
}
