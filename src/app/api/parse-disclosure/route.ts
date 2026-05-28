import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
  Referer: "https://dart.fss.or.kr/",
};

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function relevanceScore(text: string): number {
  return (text.match(/전환|사채|발행|이자율|만기|전환가|납입/g) ?? []).length;
}

/** DART main.do(프레임셋) → 실제 문서 HTML 텍스트 반환 */
async function fetchDartText(rcpNo: string): Promise<string> {
  const viewerUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`;
  const viewerRes = await fetch(viewerUrl, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(10000),
  });
  const viewerHtml = await viewerRes.text();

  // 프레임셋 안에 포함된 .htm 문서 URL 수집
  const docUrls: string[] = [];
  const htmRe = /["']((?:https?:\/\/dart\.fss\.or\.kr)?\/html\/[^"'\s]+\.htm(?:l)?)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = htmRe.exec(viewerHtml)) !== null) {
    const url = m[1].startsWith("http")
      ? m[1]
      : `https://dart.fss.or.kr${m[1]}`;
    if (!docUrls.includes(url)) docUrls.push(url);
  }

  // 각 문서 후보를 fetch → 관련도 점수 최고인 것 선택
  let bestText = "";
  for (const url of docUrls.slice(0, 6)) {
    try {
      const res = await fetch(url, {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      const t = htmlToText(await res.text());
      if (relevanceScore(t) > relevanceScore(bestText)) bestText = t;
    } catch {
      continue;
    }
  }

  return bestText || htmlToText(viewerHtml);
}

function extractRcpNo(url: string): string | null {
  const m = url.match(/rcpNo=(\d+)/i);
  return m ? m[1] : null;
}

/** 키워드 이후 구간에서 콜론+값 또는 공백+값 형태를 추출 */
function extractPattern(text: string, patterns: string[]): string | undefined {
  for (const pat of patterns) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 80);
    // "키워드 : 값" 또는 "키워드 값" 형태
    const m = slice.match(/[：:]\s*([^\s:：,()]{2,80})/) ??
              slice.match(new RegExp(pat + "\\s+([^\\s:：,()]{2,80})", "i"));
    if (m) return m[1].trim();
  }
  return undefined;
}

function extractDate(text: string, patterns: string[]): string | undefined {
  for (const pat of patterns) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 120);
    // "2024년 1월 15일" 또는 "2024-01-15" 또는 "2024.01.15"
    const m = slice.match(/(\d{4})[년\-./][\s]*(\d{1,2})[월\-./][\s]*(\d{1,2})/);
    if (m) {
      return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    }
  }
  return undefined;
}

function extractAmount(text: string, patterns: string[]): number | undefined {
  for (const pat of patterns) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 200);
    // "5,000원" 또는 "5000원" 형태
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
  // 종목코드 6자리 (숫자만)
  for (const pat of ["종목코드", "주권\\s*종목코드", "상장\\s*종목코드"]) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 60);
    const m = slice.match(/\b(\d{6})\b/);
    if (m) return m[1];
  }
  return undefined;
}

function extractCompanyName(text: string): string | undefined {
  for (const pat of ["발행\\s*회사", "회사명", "법인명"]) {
    const idx = text.search(new RegExp(pat, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 80);
    const m = slice.match(/[：:]\s*((?:\(주\)|주식회사)?\s*[^\s:：,()]{2,30})/);
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

  function mark(field: keyof ParsedDisclosure, value: unknown) {
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
  mark("mezzanineType", result.mezzanineType);

  // 자산명 (사채의 명칭)
  const assetName = extractPattern(text, ["사채의\\s*명칭", "채권의\\s*명칭", "발행\\s*채권명"]);
  if (assetName) {
    result.assetName = assetName.slice(0, 200);
    autoFilled.push("assetName");
    const sm = assetName.match(/제\s*(\d+)\s*회/);
    if (sm) mark("seriesNumber", parseInt(sm[1]));
    else failed.push("seriesNumber");
  } else {
    failed.push("assetName");
    failed.push("seriesNumber");
  }

  // 발행 회사명 / 기초자산 회사명
  mark("underlyingCompanyName", extractCompanyName(text));

  // 종목코드
  mark("underlyingTicker", extractTicker(text));

  // 발행일 / 납입일
  mark("issueDate", extractDate(text, ["납입일", "발행일", "사채발행일"]));

  // 만기일
  mark("maturityDate", extractDate(text, ["만기일", "사채의\\s*만기", "상환\\s*만기"]));

  // 표면금리
  mark("couponRate", extractPercent(text, ["표면이자율", "표면\\s*금리", "쿠폰이자율", "이표이자율"]));

  // YTM
  mark("ytm", extractPercent(text, ["만기보장수익률", "만기\\s*수익률", "YTM", "복리수익률"]));

  // 최초 전환가
  mark(
    "initialConversionPrice",
    extractAmount(text, [
      "전환가액\\s*[：:]",
      "전환\\s*가액\\s*[：:]",
      "행사가액\\s*[：:]",
      "전환가액",   // 콜론 없는 경우 fallback
    ])
  );

  // 최저 전환가 (리픽싱 한도)
  mark(
    "minConversionPrice",
    extractAmount(text, [
      "전환가액의?\\s*조정.{0,50}최저",
      "리픽싱.{0,50}최저",
      "최저\\s*전환가",
      "하한가",
      "최저한도",
    ])
  );

  // 전환청구기간 시작
  mark(
    "conversionStartDate",
    extractDate(text, [
      "전환청구기간",
      "전환가능기간",
      "전환권\\s*행사기간",
    ])
  );

  // 전환청구기간 종료 (시작일 이후 구간에서 두 번째 날짜)
  const convStart = result.conversionStartDate;
  const convEnd = (() => {
    for (const pat of ["전환청구기간", "전환가능기간", "전환권\\s*행사기간"]) {
      const idx = text.search(new RegExp(pat, "i"));
      if (idx === -1) continue;
      const slice = text.slice(idx, idx + 250);
      const dates: string[] = [];
      const dateRe = /(\d{4})[년\-./][\s]*(\d{1,2})[월\-./][\s]*(\d{1,2})/g;
      let dm: RegExpExecArray | null;
      while ((dm = dateRe.exec(slice)) !== null) {
        const d = `${dm[1]}-${dm[2].padStart(2,"0")}-${dm[3].padStart(2,"0")}`;
        dates.push(d);
      }
      if (dates.length >= 2) return dates[dates.length - 1];
    }
    return undefined;
  })();
  mark("conversionEndDate", convEnd !== convStart ? convEnd : undefined);

  // 풋옵션
  mark(
    "putOptionRate",
    extractPercent(text, [
      "조기상환청구.{0,80}수익률",
      "풋옵션.{0,80}수익률",
      "조기상환\\s*수익률",
      "Put\\s*Option.{0,80}수익률",
    ])
  );

  // 콜옵션 비율
  mark(
    "callOptionRatio",
    extractPercent(text, [
      "매도청구권.{0,80}비율",
      "콜옵션.{0,80}비율",
      "Call\\s*Option.{0,80}비율",
    ])
  );

  return { data: result, autoFilledFields: autoFilled, failedFields: failed };
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

    let text: string;
    try {
      text = await fetchDartText(rcpNo);
    } catch {
      return NextResponse.json(
        {
          error: "DART 공시를 가져오는데 실패했습니다. 잠시 후 다시 시도해주세요.",
          data: {},
          autoFilledFields: [],
          failedFields: [],
        },
        { status: 200 }
      );
    }

    if (!text || text.length < 100) {
      return NextResponse.json(
        {
          error: "공시 내용을 읽을 수 없습니다. DART 사이트에서 직접 확인해주세요.",
          data: {},
          autoFilledFields: [],
          failedFields: [],
        },
        { status: 200 }
      );
    }

    const result = parseDisclosureText(text, url);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[parse-disclosure]", err);
    return NextResponse.json({ error: "파싱 중 오류가 발생했습니다." }, { status: 500 });
  }
}
