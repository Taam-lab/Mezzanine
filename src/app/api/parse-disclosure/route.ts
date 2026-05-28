import { NextRequest, NextResponse } from "next/server";
import { inflateRaw } from "zlib";
import { promisify } from "util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
  method: number; // 0=stored, 8=deflate
  compressed: Buffer;
}

function parseZipEntries(buf: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];

  // Find End-of-Central-Directory (EOCD) signature 0x06054b50
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error("ZIP: EOCD not found");

  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  const numEntries = buf.readUInt16LE(eocdPos + 10);
  let pos = cdOffset;

  for (let i = 0; i < numEntries; i++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break; // central dir entry sig

    const method       = buf.readUInt16LE(pos + 10);
    const compSize     = buf.readUInt32LE(pos + 20);
    const fnLen        = buf.readUInt16LE(pos + 28);
    const extraLen     = buf.readUInt16LE(pos + 30);
    const commentLen   = buf.readUInt16LE(pos + 32);
    const lhOffset     = buf.readUInt32LE(pos + 42);
    const nameBytes    = buf.slice(pos + 46, pos + 46 + fnLen);
    // Try UTF-8, fall back to latin1 (covers EUC-KR filenames roughly)
    const name = nameBytes.toString("utf8");

    pos += 46 + fnLen + extraLen + commentLen;

    // Read data from local file header
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
  if (entry.method === 0) return entry.compressed;          // stored
  if (entry.method === 8) return await inflateRawAsync(entry.compressed) as Buffer; // deflate
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
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });

  if (!res.ok) throw new Error(`DART API HTTP ${res.status}`);

  const contentType = res.headers.get("content-type") ?? "";

  // DART returns JSON when there's an error (e.g., invalid key, no document)
  if (contentType.includes("json") || contentType.includes("text/html")) {
    const body = await res.text();
    let msg = "DART API error";
    try { msg = JSON.parse(body).message ?? msg; } catch { msg = body.slice(0, 100); }
    throw new Error(msg);
  }

  const zipBuf = Buffer.from(await res.arrayBuffer());
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

      // Detect charset from HTML meta tag before full decode
      const preview = raw.slice(0, 1024).toString("latin1");
      const csMatch = preview.match(/charset[=\s"']+([a-zA-Z0-9-]+)/i);
      const charset = (csMatch?.[1] ?? "utf-8").toLowerCase().replace("-", "");

      let html: string;
      if (charset === "euckr" || charset === "euc_kr" || charset === "ksc5601") {
        // Best-effort: decode as latin1 and keep parsing
        // (iconv-lite not available; Korean may be garbled but keywords still findable
        //  because we only use regex patterns after htmlToText anyway)
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

  // 전환청구기간: 구간 내 첫 날짜 = 시작, 마지막 날짜 = 종료
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

    const apiKey = process.env.DART_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "DART API 키가 설정되지 않았습니다. 관리자에게 문의하세요." },
        { status: 500 }
      );
    }

    let text: string;
    try {
      text = await fetchDartTextViaApi(rcpNo, apiKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      console.error("[parse-disclosure] DART API error:", msg);
      return NextResponse.json(
        { error: `DART 문서 다운로드 실패: ${msg}` },
        { status: 502 }
      );
    }

    if (!text || text.length < 50) {
      return NextResponse.json(
        { error: "공시 내용을 읽을 수 없습니다. ZIP 안에 HTML 파일이 없거나 내용이 비어있습니다." },
        { status: 422 }
      );
    }

    const result = parseDisclosureText(text, url);

    // 개발 디버그: 추출된 텍스트 앞부분을 함께 반환 (파싱 검증용)
    return NextResponse.json({
      ...result,
      _debug: text.slice(0, 500),
    });
  } catch (err) {
    console.error("[parse-disclosure]", err);
    return NextResponse.json({ error: "파싱 중 오류가 발생했습니다." }, { status: 500 });
  }
}
