import { NextRequest, NextResponse } from "next/server";
import { inflateRaw } from "zlib";
import { promisify } from "util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const inflateRawAsync = promisify(inflateRaw);

interface ParsedDisclosure {
  assetName?: string;
  underlyingCompanyName?: string;
  underlyingTicker?: string;
  mezzanineType?: string;
  issueDate?: string;
  maturityDate?: string;
  couponRate?: number;
  ytm?: number;
  initialConversionPrice?: number;
  minConversionPrice?: number;
  conversionStartDate?: string;
  conversionEndDate?: string;
  putOptionRate?: number;
  callOptionRatio?: number;
  callOptionRate?: number;
  seriesNumber?: number;
  sourceDisclosureUrl?: string;
}

// ──────────────────────────────────────────────
// ZIP parser (no external dependency)
// ──────────────────────────────────────────────

interface ZipEntry {
  name: string;
  method: number;
  compressed: Buffer;
}

function parseZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error("ZIP: EOCD not found");

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const numEntries = buf.readUInt16LE(eocdPos + 10);
  let pos = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;

    const method     = buf.readUInt16LE(pos + 10);
    const compSize   = buf.readUInt32LE(pos + 20);
    const fnLen      = buf.readUInt16LE(pos + 28);
    const extraLen   = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const lhOffset   = buf.readUInt32LE(pos + 42);
    const nameBytes  = buf.slice(pos + 46, pos + 46 + fnLen);
    const name       = nameBytes.toString("utf8");

    pos += 46 + fnLen + extraLen + commentLen;

    if (buf.readUInt32LE(lhOffset) !== 0x04034b50) continue;
    const lhFnLen    = buf.readUInt16LE(lhOffset + 26);
    const lhExtraLen = buf.readUInt16LE(lhOffset + 28);
    const dataStart  = lhOffset + 30 + lhFnLen + lhExtraLen;
    const compressed = buf.slice(dataStart, dataStart + compSize);

    entries.push({ name, method, compressed });
  }

  return entries;
}

async function extractEntry(entry: ZipEntry): Promise<Buffer> {
  if (entry.method === 0) return entry.compressed;
  if (entry.method === 8) return await inflateRawAsync(entry.compressed) as Buffer;
  throw new Error(`Unsupported ZIP method: ${entry.method}`);
}

// ──────────────────────────────────────────────
// HTML utilities
// ──────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, c) => String.fromCharCode(Number(c)))
    .replace(/\s+/g, " ")
    .trim();
}

function relevanceScore(text: string): number {
  return (text.match(/전환|사채|발행|이자율|만기|전환가|납입/g) ?? []).length;
}

// 본문(상세 발행조건)에만 등장하는 키워드 — TOC/메뉴와 구별용
function isRealContent(text: string): boolean {
  const strong = (text.match(/이자율|만기일|납입일|전환가액|전환청구|행사가액|표면금리|수익률|사채의\s*권면/g) ?? []).length;
  return strong >= 3 && text.length >= 500;
}

// ──────────────────────────────────────────────
// DART Open API document fetch
// ──────────────────────────────────────────────

async function fetchDartTextViaApi(rcpNo: string, apiKey: string): Promise<string> {
  const url = `https://opendart.fss.or.kr/api/document.do?crtfc_key=${apiKey}&rcept_no=${rcpNo}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });

  if (!res.ok) throw new Error(`DART API HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("json")) {
    const body = await res.text();
    let msg = "DART API error";
    try { msg = JSON.parse(body).message ?? msg; } catch { msg = body.slice(0, 200); }
    throw new Error(msg);
  }

  if (contentType.includes("text/html")) {
    const body = await res.text();
    throw new Error(body.slice(0, 300));
  }

  const zipBuf = Buffer.from(await res.arrayBuffer());

  // Verify ZIP magic bytes (PK signature)
  if (zipBuf.length < 4 || zipBuf[0] !== 0x50 || zipBuf[1] !== 0x4B) {
    throw new Error(`ZIP 형식 아님: ${zipBuf.slice(0, 80).toString("utf8")}`);
  }

  const entries = parseZipEntries(zipBuf);

  const htmlEntries = entries.filter(
    (e) => e.name.toLowerCase().endsWith(".htm") || e.name.toLowerCase().endsWith(".html")
  );
  if (htmlEntries.length === 0) {
    const names = entries.map((e) => e.name).join(", ");
    throw new Error(`ZIP에 HTML 파일 없음. 포함된 파일: ${names || "(없음)"}`);
  }

  let bestText = "";
  for (const entry of htmlEntries) {
    try {
      const raw = await extractEntry(entry);
      const preview = raw.slice(0, 1024).toString("latin1");
      const csMatch = preview.match(/charset[=\s"']+([a-zA-Z0-9-]+)/i);
      const charset = (csMatch?.[1] ?? "utf-8").toLowerCase().replace("-", "");

      let html: string;
      if (charset === "euckr" || charset === "euc_kr" || charset === "ksc5601") {
        html = raw.toString("latin1");
      } else {
        html = raw.toString("utf8");
      }

      const text = htmlToText(html);
      if (relevanceScore(text) > relevanceScore(bestText)) bestText = text;
    } catch { continue; }
  }

  return bestText;
}

// ──────────────────────────────────────────────
// DART web scraping fallback (public viewer)
// ──────────────────────────────────────────────

async function fetchDartTextViaScraping(rcpNo: string): Promise<{ text: string; debugInfo: string }> {
  const base = "https://dart.fss.or.kr";
  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9",
  };

  const mainUrl = `${base}/dsaf001/main.do?rcpNo=${rcpNo}`;
  const mainRes = await fetch(mainUrl, { signal: AbortSignal.timeout(10000), headers });
  if (!mainRes.ok) throw new Error(`DART viewer HTTP ${mainRes.status}`);
  const mainHtml = await mainRes.text();

  const setCookie = mainRes.headers.get("set-cookie");
  if (setCookie) headers["Cookie"] = setCookie.split(";")[0];

  // main.do는 frameset/TOC 페이지 — 본문이 충분히 들어있는 경우에만 직접 채택
  const mainText = htmlToText(mainHtml);
  if (isRealContent(mainText)) return { text: mainText, debugInfo: "main.do 직접 파싱" };

  const docUrls = new Set<string>();
  const dcmNos = new Set<string>();
  const debugLines: string[] = [];

  // ───── main.do에서 dcmNo / URL 패턴 추출 ─────
  collectDocPatterns(mainHtml, base, rcpNo, docUrls, dcmNos, debugLines, "main");

  // ───── sub.do (좌측 트리/문서 인덱스) ─────
  let subHtml = "";
  try {
    const subUrl = `${base}/dsaf001/sub.do?rcpNo=${rcpNo}`;
    const subRes = await fetch(subUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { ...headers, Referer: mainUrl },
    });
    if (subRes.ok) {
      subHtml = await subRes.text();
      debugLines.push(`sub.do=${subHtml.length}b`);
      const subText = htmlToText(subHtml);
      if (isRealContent(subText)) return { text: subText, debugInfo: `sub.do 직접 파싱 | ${debugLines.join(",")}` };
      collectDocPatterns(subHtml, base, rcpNo, docUrls, dcmNos, debugLines, "sub");
    } else {
      debugLines.push(`sub.do HTTP ${subRes.status}`);
    }
  } catch (e) {
    debugLines.push(`sub.do err: ${String(e).slice(0, 50)}`);
  }

  // 추출된 dcmNo로 viewer.do URL 구성 (eleId 다양화)
  for (const dcm of dcmNos) {
    for (const eleId of ["0", "1", "2"]) {
      docUrls.add(`${base}/report/viewer.do?rcpNo=${rcpNo}&dcmNo=${dcm}&eleId=${eleId}&offset=0&length=0&dtd=dart3.xsd`);
    }
  }

  const debugStr = debugLines.join(" | ") + ` | dcmNos=[${[...dcmNos].join(",")}]`;

  if (docUrls.size === 0) {
    // 본문 URL을 못 찾으면 HTML 원본 일부를 디버그에 노출
    const snippet = (subHtml || mainHtml).slice(0, 800).replace(/[\s\n\r]+/g, " ");
    throw new Error(`본문 URL 추출 실패 [${debugStr}] | HTML: ${snippet}`);
  }

  let bestText = "";
  let bestScore = 0;
  const tried: string[] = [];
  for (const docUrl of [...docUrls].slice(0, 12)) {
    try {
      const r = await fetch(docUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { ...headers, Referer: mainUrl },
      });
      tried.push(`${docUrl.slice(-60)}=${r.status}`);
      if (!r.ok) continue;

      const ct = r.headers.get("content-type") ?? "";
      let html: string;
      if (ct.toLowerCase().includes("euc-kr") || ct.toLowerCase().includes("ks_c_5601")) {
        html = Buffer.from(await r.arrayBuffer()).toString("latin1");
      } else {
        html = await r.text();
      }
      const text = htmlToText(html);
      const score = relevanceScore(text);
      if (score > bestScore && text.length > 200) {
        bestScore = score;
        bestText = text;
      }
    } catch { continue; }
  }

  if (!bestText || bestText.length < 200) {
    throw new Error(`본문 내용 없음 [${debugStr}] 시도: ${tried.slice(0, 4).join(" / ")}`);
  }
  return { text: bestText, debugInfo: `${debugStr} | best=${bestScore}점` };
}

// HTML에서 dcmNo 및 본문 URL 후보를 폭넓게 수집
function collectDocPatterns(
  html: string,
  base: string,
  rcpNo: string,
  docUrls: Set<string>,
  dcmNos: Set<string>,
  debug: string[],
  tag: string,
): void {
  let foundFrames = 0;
  let foundDcm = 0;

  // frame/iframe src
  for (const m of html.matchAll(/<(?:frame|iframe)[^>]+src=["']([^"']+)["']/gi)) {
    const u = m[1].replace(/&amp;/g, "&").trim();
    if (u && !u.startsWith("javascript") && u !== "about:blank") {
      docUrls.add(u.startsWith("http") ? u : `${base}${u.startsWith("/") ? u : "/" + u}`);
      foundFrames++;
    }
  }

  // 직접 viewer.do URL
  for (const m of html.matchAll(/["'(]([^"'()]*\/report\/viewer\.do\?[^"'()]+)["')]/gi)) {
    const u = m[1].replace(/&amp;/g, "&");
    docUrls.add(u.startsWith("http") ? u : `${base}${u}`);
  }

  // dcmNo 추출: JS 변수, 함수 인자, hidden input, data-* 속성 등
  const dcmPatterns = [
    /['"]?dcmNo['"]?\s*[:=,]\s*['"]?(\d{6,12})/gi,
    /name=["']dcmNo["']\s+value=["'](\d{6,12})["']/gi,
    /value=["'](\d{6,12})["']\s+name=["']dcmNo["']/gi,
    /data-(?:dcm|dcmno|dcm-no)=["'](\d{6,12})["']/gi,
    /(?:goView|viewDoc|fn_view|openDoc|viewReport|openPdfDownload|openSelected)\s*\(\s*['"]?\d*['"]?\s*,\s*['"]?(\d{6,12})/gi,
    /(?:goView|viewDoc|fn_view|openDoc|viewReport)\s*\(\s*['"]?(\d{6,12})/gi,
  ];
  for (const re of dcmPatterns) {
    for (const m of html.matchAll(re)) {
      if (m[1] && m[1].length >= 6) {
        dcmNos.add(m[1]);
        foundDcm++;
      }
    }
  }

  debug.push(`${tag}: frames=${foundFrames} dcm=${foundDcm}`);
}

// ──────────────────────────────────────────────
// Parsing helpers
// ──────────────────────────────────────────────

function extractDate(text: string, patterns: string[]): string | undefined {
  for (const pat of patterns) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 150);
    const m = slice.match(/(\d{4})[년\-./][\s]*(\d{1,2})[월\-./][\s]*(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  }
  return undefined;
}

function extractAmount(text: string, patterns: string[]): number | undefined {
  for (const pat of patterns) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 200);
    const m = slice.match(/([\d,]+)\s*원/);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return undefined;
}

function extractPercent(text: string, patterns: string[]): number | undefined {
  for (const pat of patterns) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 120);
    const m = slice.match(/([\d.]+)\s*%/);
    if (m) return parseFloat(m[1]);
  }
  return undefined;
}

function extractTicker(text: string): string | undefined {
  for (const pat of ["종목코드", "주권\\s*종목코드", "상장\\s*종목코드"]) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const m = text.slice(idx, idx + 60).match(/\b(\d{6})\b/);
    if (m) return m[1];
  }
  return undefined;
}

function extractCompanyName(text: string): string | undefined {
  for (const pat of ["발행\\s*회사", "회사명\\s*[：:]", "법인명\\s*[：:]"]) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const m = text.slice(idx, idx + 80).match(/[：:]\s*((?:\(주\)|주식회사)?\s*[^\s:：,()]{2,30})/);
    if (m) return m[1].trim();
  }
  return undefined;
}

function parseDisclosureText(
  text: string,
  sourceUrl: string
): { data: ParsedDisclosure; autoFilledFields: string[]; failedFields: string[] } {
  const result: ParsedDisclosure = { sourceDisclosureUrl: sourceUrl };
  const autoFilled: string[] = [];
  const failed: string[] = [];

  function set(field: keyof ParsedDisclosure, value: unknown) {
    if (value !== undefined && value !== null) {
      (result as Record<string, unknown>)[field] = value;
      autoFilled.push(field);
    } else {
      failed.push(field);
    }
  }

  // 메자닌 형태
  if (text.includes("전환사채")) result.mezzanineType = "CB";
  else if (text.includes("신주인수권부사채")) result.mezzanineType = "BW";
  else if (text.includes("교환사채")) result.mezzanineType = "EB";
  set("mezzanineType", result.mezzanineType);

  // 자산명 & 회차
  const assetIdx = text.search(/사채의\s*명칭|채권의\s*명칭|발행\s*채권명/i);
  if (assetIdx !== -1) {
    const assetSlice = text.slice(assetIdx, assetIdx + 120);
    const am = assetSlice.match(/[：:]\s*([^\n:：]{4,80})/) ??
               assetSlice.match(/명칭\s+([^\n:：]{4,80})/);
    if (am) {
      const name = am[1].trim().slice(0, 200);
      result.assetName = name;
      autoFilled.push("assetName");
      const sm = name.match(/제\s*(\d+)\s*회/);
      set("seriesNumber", sm ? parseInt(sm[1]) : undefined);
    } else {
      failed.push("assetName"); failed.push("seriesNumber");
    }
  } else {
    failed.push("assetName"); failed.push("seriesNumber");
  }

  set("underlyingCompanyName", extractCompanyName(text));
  set("underlyingTicker", extractTicker(text));

  set("issueDate",    extractDate(text, ["납입일", "발행일", "사채발행일"]));
  set("maturityDate", extractDate(text, ["만기일", "사채의\\s*만기", "상환\\s*만기"]));

  set("couponRate", extractPercent(text, ["표면이자율", "표면\\s*금리", "쿠폰이자율", "이표이자율"]));
  set("ytm",        extractPercent(text, ["만기보장수익률", "만기\\s*수익률", "YTM", "복리수익률"]));

  set("initialConversionPrice", extractAmount(text, [
    "전환가액\\s*[：:]", "전환\\s*가액\\s*[：:]", "행사가액\\s*[：:]", "전환가액",
  ]));
  set("minConversionPrice", extractAmount(text, [
    "전환가액의?\\s*조정.{0,60}최저", "리픽싱.{0,60}최저",
    "최저\\s*전환가", "하한가", "최저한도",
  ]));

  // 전환청구기간
  const cvIdx = text.search(/전환청구기간|전환가능기간|전환권\s*행사기간/i);
  if (cvIdx !== -1) {
    const cvSlice = text.slice(cvIdx, cvIdx + 300);
    const dates: string[] = [];
    const dateRe = /(\d{4})[년\-./][\s]*(\d{1,2})[월\-./][\s]*(\d{1,2})/g;
    let dm: RegExpExecArray | null;
    while ((dm = dateRe.exec(cvSlice)) !== null) {
      dates.push(`${dm[1]}-${dm[2].padStart(2,"0")}-${dm[3].padStart(2,"0")}`);
    }
    set("conversionStartDate", dates[0]);
    set("conversionEndDate",   dates.length > 1 ? dates[dates.length - 1] : undefined);
  } else {
    failed.push("conversionStartDate"); failed.push("conversionEndDate");
  }

  set("putOptionRate", extractPercent(text, [
    "조기상환청구.{0,100}수익률", "풋옵션.{0,100}수익률", "조기상환\\s*수익률",
  ]));
  set("callOptionRatio", extractPercent(text, [
    "매도청구권.{0,100}비율", "콜옵션.{0,100}비율",
  ]));
  set("callOptionRate", extractPercent(text, [
    "매도청구권.{0,100}수익률", "콜옵션.{0,100}수익률", "매도청구\\s*수익률",
  ]));

  return { data: result, autoFilledFields: autoFilled, failedFields: failed };
}

// ──────────────────────────────────────────────
// Route handler
// ──────────────────────────────────────────────

function extractRcpNo(url: string): string | null {
  const m = url.match(/rcpNo=(\d+)/i);
  return m ? m[1] : null;
}

export async function POST(req: NextRequest) {
  try {
    const { url } = (await req.json()) as { url: string };

    if (!url?.includes("dart.fss.or.kr")) {
      return NextResponse.json(
        { error: "DART 공시 URL을 입력해주세요. (https://dart.fss.or.kr/...)" },
        { status: 400 }
      );
    }

    const rcpNo = extractRcpNo(url);
    if (!rcpNo) {
      return NextResponse.json(
        { error: "URL에서 공시 번호(rcpNo)를 찾을 수 없습니다." },
        { status: 400 }
      );
    }

    let text = "";
    let lastError = "";
    let scrapeDebug = "";

    // 1차: DART Open API (ZIP 다운로드)
    const apiKey = process.env.DART_API_KEY;
    if (apiKey) {
      try {
        text = await fetchDartTextViaApi(rcpNo, apiKey);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error("[parse-disclosure] DART API failed:", lastError.slice(0, 200));
      }
    }

    // 2차: 공개 DART 뷰어 스크래핑 (API 실패 시 폴백)
    if (!text || text.length < 50) {
      try {
        const result = await fetchDartTextViaScraping(rcpNo);
        text = result.text;
        scrapeDebug = result.debugInfo;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[parse-disclosure] Scraping failed:", msg.slice(0, 300));
        lastError = lastError ? `${lastError} / 스크래핑 실패: ${msg}` : msg;
      }
    }

    if (!text || text.length < 50) {
      return NextResponse.json(
        { error: `DART 문서 다운로드 실패: ${lastError}` },
        { status: 502 }
      );
    }

    const result = parseDisclosureText(text, url);

    return NextResponse.json({
      ...result,
      _debug: text.slice(0, 500),
      _scrapeDebug: scrapeDebug || undefined,
    });
  } catch (err) {
    console.error("[parse-disclosure]", err);
    return NextResponse.json({ error: "파싱 중 오류가 발생했습니다." }, { status: 500 });
  }
}
