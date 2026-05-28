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

  // If main page itself has disclosure content, use it
  const mainText = htmlToText(mainHtml);
  if (relevanceScore(mainText) >= 5) return { text: mainText, debugInfo: "main.do 직접 파싱" };

  const docUrls = new Set<string>();
  const debugLines: string[] = [];

  // Look for any frame/iframe src attributes
  for (const m of mainHtml.matchAll(/<(?:frame|iframe)[^>]+src=["']([^"']+)["']/gi)) {
    const u = m[1].replace(/&amp;/g, "&").trim();
    if (u && !u.startsWith("javascript") && u !== "about:blank" && u !== "") {
      const full = u.startsWith("http") ? u : `${base}${u}`;
      docUrls.add(full);
      debugLines.push(`frame: ${full}`);
    }
  }

  // viewer.do URLs anywhere in the page
  for (const m of mainHtml.matchAll(/["']([^"']*viewer\.do\?[^"']*)["']/gi)) {
    const u = m[1].replace(/&amp;/g, "&");
    const full = u.startsWith("http") ? u : `${base}${u}`;
    docUrls.add(full);
    debugLines.push(`viewer: ${full}`);
  }

  // dcmNo in JS variables → construct viewer URL
  for (const m of mainHtml.matchAll(/['"]?dcmNo['"]?\s*[:=,]\s*['"]?(\d{7,12})['"]?/gi)) {
    const url = `${base}/report/viewer.do?rcpNo=${rcpNo}&dcmNo=${m[1]}&eleId=0&offset=0&length=0&dtd=dart3.xsd`;
    docUrls.add(url);
    debugLines.push(`dcmNo(main): ${m[1]}`);
  }

  // Try sub.do (document index sidebar)
  try {
    const subUrl = `${base}/dsaf001/sub.do?rcpNo=${rcpNo}`;
    const subRes = await fetch(subUrl, {
      signal: AbortSignal.timeout(8000),
      headers: { ...headers, Referer: mainUrl },
    });
    if (subRes.ok) {
      const subHtml = await subRes.text();
      debugLines.push(`sub.do: ${subHtml.length}bytes`);

      // sub.do content itself
      const subText = htmlToText(subHtml);
      if (relevanceScore(subText) >= 5) return { text: subText, debugInfo: "sub.do 직접 파싱" };

      // viewer.do URLs in sub.do
      for (const m of subHtml.matchAll(/["']([^"']*viewer\.do\?[^"']*)["']/gi)) {
        const u = m[1].replace(/&amp;/g, "&");
        docUrls.add(u.startsWith("http") ? u : `${base}${u}`);
      }

      // JS function calls: goView('dcmNo', ...) / fn_view('dcmNo', ...) etc.
      for (const m of subHtml.matchAll(/(?:goView|viewDoc|fn_view|openDoc|viewReport)\s*\(\s*['"]?(\d{7,12})['"]?/gi)) {
        const url = `${base}/report/viewer.do?rcpNo=${rcpNo}&dcmNo=${m[1]}&eleId=0&offset=0&length=0&dtd=dart3.xsd`;
        docUrls.add(url);
        debugLines.push(`goView dcmNo: ${m[1]}`);
      }

      // data-dcm attributes
      for (const m of subHtml.matchAll(/data-(?:dcm|dcmno|dcm-no)=["'](\d{7,12})["']/gi)) {
        const url = `${base}/report/viewer.do?rcpNo=${rcpNo}&dcmNo=${m[1]}&eleId=0&offset=0&length=0&dtd=dart3.xsd`;
        docUrls.add(url);
        debugLines.push(`data-dcm: ${m[1]}`);
      }

      // dcmNo in JS variables
      for (const m of subHtml.matchAll(/['"]?dcmNo['"]?\s*[:=,]\s*['"]?(\d{7,12})['"]?/gi)) {
        const url = `${base}/report/viewer.do?rcpNo=${rcpNo}&dcmNo=${m[1]}&eleId=0&offset=0&length=0&dtd=dart3.xsd`;
        docUrls.add(url);
        debugLines.push(`dcmNo(sub): ${m[1]}`);
      }

      // href links that look like document pages
      for (const m of subHtml.matchAll(/href=["']([^"']+\.html?)["']/gi)) {
        const u = m[1].replace(/&amp;/g, "&");
        docUrls.add(u.startsWith("http") ? u : `${base}${u}`);
      }
    } else {
      debugLines.push(`sub.do HTTP ${subRes.status}`);
    }
  } catch (e) {
    debugLines.push(`sub.do error: ${e}`);
  }

  const debugStr = debugLines.join(" | ") || "no patterns found";

  if (docUrls.size === 0) {
    const snippet = mainHtml.slice(0, 400).replace(/\s+/g, " ");
    throw new Error(`URL 없음 [${debugStr}] 페이지: ${snippet}`);
  }

  let bestText = "";
  const triedUrls: string[] = [];
  for (const docUrl of [...docUrls].slice(0, 8)) {
    triedUrls.push(docUrl);
    try {
      const r = await fetch(docUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { ...headers, Referer: mainUrl },
      });
      if (!r.ok) { triedUrls[triedUrls.length - 1] += `(${r.status})`; continue; }

      const ct = r.headers.get("content-type") ?? "";
      let html: string;
      if (ct.toLowerCase().includes("euc-kr") || ct.toLowerCase().includes("ks_c_5601")) {
        html = Buffer.from(await r.arrayBuffer()).toString("latin1");
      } else {
        html = await r.text();
      }
      const text = htmlToText(html);
      if (relevanceScore(text) > relevanceScore(bestText)) bestText = text;
    } catch { continue; }
  }

  if (!bestText || bestText.length < 100) {
    throw new Error(`내용 없음. 시도: ${triedUrls.slice(0, 3).join(", ")}`);
  }
  return { text: bestText, debugInfo: debugStr };
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
