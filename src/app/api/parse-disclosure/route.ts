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
  issueAmount?: number;
  couponRate?: number;
  ytm?: number;
  initialConversionPrice?: number;
  minConversionPrice?: number;
  conversionStartDate?: string;
  conversionEndDate?: string;
  putOptionRate?: number;
  putOptionStartDate?: string;
  putOptionEndDate?: string;
  callOptionRatio?: number;
  callOptionRate?: number;
  callOptionStartDate?: string;
  callOptionEndDate?: string;
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
// DART Open API – list.json으로 종목코드 조회
// ──────────────────────────────────────────────

async function fetchTickerFromDart(rcpNo: string, apiKey: string): Promise<string | null> {
  try {
    const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${apiKey}&rcept_no=${rcpNo}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json() as { status?: string; list?: Array<{ stock_code?: string }> };
    const code = data.list?.[0]?.stock_code?.trim();
    return (code && /^\d{6}$/.test(code)) ? code : null;
  } catch {
    return null;
  }
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
    // "5,000원" 또는 "(원/주) 5,000" 또는 "(원) 25,000,000,000" 다양한 형식
    const m =
      slice.match(/([\d,]+)\s*원/) ??
      slice.match(/\(원[/／주\s]*\)\s*([\d,]+)/) ??
      slice.match(/\(원\)\s*([\d,]+)/) ??
      slice.match(/[：:]\s*([\d,]{3,})/);
    if (m) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(val) && val > 0) return val;
    }
  }
  return undefined;
}

function extractAllDates(text: string): string[] {
  const dates: string[] = [];
  const re = /(\d{4})[년\-./][\s]*(\d{1,2})[월\-./][\s]*(\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    dates.push(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  }
  return dates;
}

function extractPercent(text: string, patterns: string[]): number | undefined {
  for (const pat of patterns) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 150);
    // "(%) 4.0" 형식 — DART 표 형식에서 단위 먼저, 값 나중
    const m2 = slice.match(/\(%\)\s*([\d.]+)/);
    // "4.0%" 형식 — 일반 문장 형식
    const m1 = slice.match(/([\d.]+)\s*%/);
    if (m2 && m1) {
      return parseFloat(slice.indexOf(m2[0]) <= slice.indexOf(m1[0]) ? m2[1] : m1[1]);
    }
    if (m2) return parseFloat(m2[1]);
    if (m1) return parseFloat(m1[1]);
  }
  return undefined;
}

function extractTicker(text: string): string | undefined {
  for (const pat of ["종목코드", "주권\\s*종목코드", "상장\\s*종목코드", "단축코드"]) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const m = text.slice(idx, idx + 60).match(/\b(\d{6})\b/);
    if (m) return m[1];
  }
  return undefined;
}

function cleanCompanyName(raw: string): string {
  return raw
    .replace(/\s*(주식회사|㈜|\(주\)|\(株\)|유한회사|합자회사)\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCompanyName(text: string): string | undefined {
  // "회 사 명 : 삼보모터스 주식회사 대 표 이 사 :" 와 같이 글자 사이 공백이 들어간 형식 처리
  const patterns = [
    /회\s*사\s*명\s*[：:]\s*(.+?)\s+대\s*표\s*이\s*사/,
    /회\s*사\s*명\s*[：:]\s*(.+?)(?=\s+(?:본\s*점|소\s*재|전\s*화|작\s*성|이\s*사\s*명))/,
    /발\s*행\s*회\s*사\s*[：:]?\s*(.+?)(?=\s+(?:대\s*표|본\s*점))/,
    /법\s*인\s*명\s*[：:]\s*(.+?)(?=\s+(?:대\s*표|본\s*점))/,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const raw = m[1].trim().replace(/\s+/g, " ").slice(0, 60);
      const name = cleanCompanyName(raw);
      if (name.length >= 2) return name;
    }
  }
  return undefined;
}

// "사채의 종류 회차 19 종류 무기명식 이권부 무보증 사모 전환사채" 형식에서
// 회차/종류 조합으로 자산명 생성
function buildAssetName(text: string): { assetName?: string; seriesNumber?: number } {
  // 회차 추출
  const seriesMatch =
    text.match(/사채의\s*종류\s*회차\s*(\d+)/) ??
    text.match(/제\s*(\d+)\s*회/) ??
    text.match(/회차\s*(\d+)/);
  const seriesNumber = seriesMatch ? parseInt(seriesMatch[1]) : undefined;

  // 종류 추출 (회차 뒤 "종류 ..."에서 "전환사채/신주인수권부사채/교환사채"까지)
  let kind: string | undefined;
  const kindMatch = text.match(
    /종류\s+((?:무기명식|기명식|이권부|무보증|보증|사모|공모|분리형|비분리형|\s)+(?:전환사채|신주인수권부사채|교환사채))/
  );
  if (kindMatch) kind = kindMatch[1].replace(/\s+/g, " ").trim();
  else if (text.includes("전환사채")) kind = "전환사채";
  else if (text.includes("신주인수권부사채")) kind = "신주인수권부사채";
  else if (text.includes("교환사채")) kind = "교환사채";

  let assetName: string | undefined;
  if (seriesNumber && kind) assetName = `제${seriesNumber}회 ${kind}`;
  else if (kind) assetName = kind;

  return { assetName, seriesNumber };
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
  const { assetName, seriesNumber } = buildAssetName(text);
  set("assetName", assetName);
  set("seriesNumber", seriesNumber);

  set("underlyingCompanyName", extractCompanyName(text));
  set("underlyingTicker", extractTicker(text));

  // 발행일: 반드시 번호 항목 "12. 납입일" 형식 우선 — "납입기일" 등에 끌려가지 않도록
  set("issueDate", extractDate(text, [
    "\\d+\\.\\s*납입일",
    "납입일\\s*[：:]",
    "사채발행일",
  ]));

  // 만기일: "5. 사채만기일" 형식 우선
  set("maturityDate", extractDate(text, [
    "\\d+\\.\\s*사채만기일",
    "사채만기일",
    "만기일\\s*[：:]",
    "상환\\s*만기",
  ]));

  // 발행총액
  set("issueAmount", extractAmount(text, [
    "사채의\\s*권면.{0,30}총액",
    "권면\\s*총액",
    "발행\\s*총액",
    "사채\\s*총액",
  ]));

  set("couponRate", extractPercent(text, ["표면이자율", "표면\\s*금리", "쿠폰이자율", "이표이자율"]));
  set("ytm",        extractPercent(text, ["만기이자율", "만기보장수익률", "만기\\s*수익률", "YTM", "복리수익률", "보장수익률"]));

  set("initialConversionPrice", extractAmount(text, [
    "전환가액\\s*\\(원[/／주\\s]*\\)",
    "행사가액\\s*\\(원[/／주\\s]*\\)",
    "전환가액\\s*[：:]",
    "행사가액\\s*[：:]",
    "전환가액",
    "행사가액",
  ]));
  set("minConversionPrice", extractAmount(text, [
    "전환가액의?\\s*조정.{0,80}최저",
    "조정\\s*최저.{0,30}전환가",
    "최저\\s*조정가액",
    "리픽싱.{0,80}최저",
    "최저\\s*전환가",
    "전환가액\\s*조정한도",
    "하한가",
  ]));

  // 전환청구기간
  const cvIdx = text.search(/전환청구기간|전환가능기간|전환권\s*행사기간/i);
  if (cvIdx !== -1) {
    const cvDates = extractAllDates(text.slice(cvIdx, cvIdx + 300));
    set("conversionStartDate", cvDates[0]);
    set("conversionEndDate",   cvDates.length > 1 ? cvDates[cvDates.length - 1] : undefined);
  } else {
    failed.push("conversionStartDate"); failed.push("conversionEndDate");
  }

  // ── 풋옵션 (조기상환청구) ──
  const putIdx = text.search(/조기상환\s*(?:청구|요구)\s*(?:기간|기일)|풋옵션.*기간/i);
  if (putIdx !== -1) {
    // 다음 번호 항목(매도청구권 등) 직전에서 잘라 오염 방지
    const afterPut = text.slice(putIdx + 20);
    const nextSecRel = afterPut.search(/\d{1,2}\.\s*(?:매도|콜옵션|사채의\s*[^전]|기타|이자지급|원금)/i);
    const windowLen = nextSecRel !== -1 ? Math.min(nextSecRel + 20, 700) : 400;
    const putSlice = text.slice(putIdx, putIdx + 20 + windowLen);
    const putDates = extractAllDates(putSlice);
    set("putOptionStartDate", putDates[0]);
    set("putOptionEndDate",   putDates.length > 1 ? putDates[putDates.length - 1] : undefined);
  } else {
    failed.push("putOptionStartDate"); failed.push("putOptionEndDate");
  }
  set("putOptionRate", extractPercent(text, [
    "조기상환청구.{0,100}수익률", "조기상환.{0,50}이율",
    "풋옵션.{0,100}수익률", "조기상환\\s*수익률",
  ]));

  // ── 콜옵션 (매도청구권) ──
  // "11. 매도청구권" 또는 "매도청구권(Call Option)" 형태의 섹션 헤더를 찾음
  // — 리픽싱 조항에 흘러나오는 단순 "매도청구권" 언급에 끌려가지 않도록 구체 패턴 사용
  const callSecIdx = text.search(/\d{1,2}\.\s*매도청구권|매도청구권\s*[\(（]\s*Call\s*Option/i);
  if (callSecIdx !== -1) {
    const callSec = text.slice(callSecIdx, callSecIdx + 2000);

    // 날짜: "매매대금 지급기일" 이후 날짜들
    const callDatesIdx = callSec.search(/매매대금\s*지급\s*기일|납입\s*기일/i);
    if (callDatesIdx !== -1) {
      const callDates = extractAllDates(callSec.slice(callDatesIdx, callDatesIdx + 800));
      set("callOptionStartDate", callDates[0]);
      set("callOptionEndDate",   callDates.length > 1 ? callDates[callDates.length - 1] : undefined);
    } else {
      failed.push("callOptionStartDate"); failed.push("callOptionEndDate");
    }

    // 콜옵션 비율: "행사 범위" / "행사 가능 범위" / "권면총액의 N%"
    const ratioMatch =
      callSec.match(/행사\s*(?:가능\s*)?범위[^%\n]{0,80}([\d.]+)\s*%/) ??
      callSec.match(/(?:권면총액|잔액|원금).{0,20}의?\s*([\d.]+)\s*%/) ??
      callSec.match(/행사\s*가능.{0,30}([\d.]+)\s*%/);
    set("callOptionRatio", ratioMatch ? parseFloat(ratioMatch[1]) : undefined);

    // 콜옵션 금리: "매매가액 원금의 N%" 에서 N을 rate로
    const rateMatch =
      callSec.match(/매매가액[^%\n]{0,50}([\d.]+)\s*%/) ??
      callSec.match(/매매\s*가액.{0,30}원금의?\s*([\d.]+)/);
    set("callOptionRate", rateMatch ? parseFloat(rateMatch[1]) : undefined);
  } else {
    failed.push("callOptionStartDate"); failed.push("callOptionEndDate");
    set("callOptionRatio", undefined);
    set("callOptionRate", undefined);
  }

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

    const apiKey = process.env.DART_API_KEY;

    // 1차: DART Open API (ZIP 다운로드) + 종목코드 조회를 병렬로
    const [docResult, tickerResult] = await Promise.allSettled([
      apiKey ? fetchDartTextViaApi(rcpNo, apiKey) : Promise.reject("no key"),
      apiKey ? fetchTickerFromDart(rcpNo, apiKey) : Promise.resolve(null),
    ]);

    if (docResult.status === "fulfilled") {
      text = docResult.value;
    } else {
      lastError = String(docResult.reason).slice(0, 200);
      console.error("[parse-disclosure] DART API failed:", lastError);
    }

    const apiTicker = tickerResult.status === "fulfilled" ? tickerResult.value : null;

    // 2차: 공개 DART 뷰어 스크래핑 (API 실패 시 폴백)
    if (!text || text.length < 50) {
      try {
        const scraped = await fetchDartTextViaScraping(rcpNo);
        text = scraped.text;
        scrapeDebug = scraped.debugInfo;
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

    // list.json 종목코드는 텍스트 파싱보다 신뢰성 높으므로 항상 우선 사용
    if (apiTicker) {
      result.data.underlyingTicker = apiTicker;
      if (!result.autoFilledFields.includes("underlyingTicker")) {
        result.autoFilledFields.push("underlyingTicker");
      }
      result.failedFields = result.failedFields.filter(f => f !== "underlyingTicker");
    }

    return NextResponse.json({
      ...result,
      _debug: text.slice(0, 1500),
      _debug2: text.slice(4000, 7000),
      _textLength: text.length,
      _scrapeDebug: scrapeDebug || undefined,
    });
  } catch (err) {
    console.error("[parse-disclosure]", err);
    return NextResponse.json({ error: "파싱 중 오류가 발생했습니다." }, { status: 500 });
  }
}
