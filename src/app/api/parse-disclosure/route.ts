import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

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

function extractRcpNo(url: string): string | null {
  const match = url.match(/rcpNo=(\d+)/);
  return match ? match[1] : null;
}

function extractPattern(text: string, patterns: string[]): string | undefined {
  for (const pattern of patterns) {
    const regex = new RegExp(pattern + "[\\s\\S]{0,30}", "i");
    const match = text.match(regex);
    if (match) {
      const valueMatch = match[0].match(/[：:]\s*(.+)/);
      if (valueMatch) return valueMatch[1].trim().replace(/\s+/g, " ");
    }
  }
  return undefined;
}

function extractDate(text: string, patterns: string[]): string | undefined {
  for (const pattern of patterns) {
    const idx = text.search(new RegExp(pattern, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 100);
    const match = slice.match(/(\d{4})[년\-./](\d{1,2})[월\-./](\d{1,2})/);
    if (match) {
      const y = match[1];
      const m = String(match[2]).padStart(2, "0");
      const d = String(match[3]).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  return undefined;
}

function extractAmount(text: string, patterns: string[]): number | undefined {
  for (const pattern of patterns) {
    const idx = text.search(new RegExp(pattern, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 150);
    const match = slice.match(/([\d,]+)\s*원/);
    if (match) {
      return parseFloat(match[1].replace(/,/g, ""));
    }
  }
  return undefined;
}

function extractPercent(text: string, patterns: string[]): number | undefined {
  for (const pattern of patterns) {
    const idx = text.search(new RegExp(pattern, "i"));
    if (idx === -1) continue;
    const slice = text.slice(idx, idx + 100);
    const match = slice.match(/([\d.]+)\s*%/);
    if (match) return parseFloat(match[1]);
  }
  return undefined;
}

function parseDisclosureText(text: string, sourceUrl: string): {
  data: ParsedDisclosure;
  autoFilledFields: string[];
  failedFields: string[];
} {
  const result: ParsedDisclosure = { sourceDisclosureUrl: sourceUrl };
  const autoFilled: string[] = [];
  const failed: string[] = [];

  // 메자닌 형태 판단
  if (text.includes("전환사채")) result.mezzanineType = "CB";
  else if (text.includes("신주인수권부사채")) result.mezzanineType = "BW";
  else if (text.includes("교환사채")) result.mezzanineType = "EB";

  if (result.mezzanineType) autoFilled.push("mezzanineType");
  else failed.push("mezzanineType");

  // 자산명
  const assetName = extractPattern(text, [
    "사채의\\s*명칭",
    "채권의\\s*명칭",
    "발행\\s*채권명",
  ]);
  if (assetName) {
    result.assetName = assetName.slice(0, 200);
    autoFilled.push("assetName");

    // 회차 추출 (예: "제5회")
    const seriesMatch = assetName.match(/제\s*(\d+)\s*회/);
    if (seriesMatch) {
      result.seriesNumber = parseInt(seriesMatch[1]);
      autoFilled.push("seriesNumber");
    }
  } else {
    failed.push("assetName");
  }

  // 발행일
  const issueDate = extractDate(text, ["납입일", "발행일", "사채발행일"]);
  if (issueDate) {
    result.issueDate = issueDate;
    autoFilled.push("issueDate");
  } else {
    failed.push("issueDate");
  }

  // 만기일
  const maturityDate = extractDate(text, ["만기일", "사채의\\s*만기", "상환\\s*만기"]);
  if (maturityDate) {
    result.maturityDate = maturityDate;
    autoFilled.push("maturityDate");
  } else {
    failed.push("maturityDate");
  }

  // 표면금리
  const couponRate = extractPercent(text, ["표면이자율", "표면\\s*금리", "쿠폰이자율"]);
  if (couponRate !== undefined) {
    result.couponRate = couponRate;
    autoFilled.push("couponRate");
  } else {
    failed.push("couponRate");
  }

  // YTM
  const ytm = extractPercent(text, ["만기보장수익률", "만기\\s*수익률", "YTM"]);
  if (ytm !== undefined) {
    result.ytm = ytm;
    autoFilled.push("ytm");
  } else {
    failed.push("ytm");
  }

  // 전환가액
  const initialConversionPrice = extractAmount(text, ["전환가액\\s*[：:]", "행사가액\\s*[：:]"]);
  if (initialConversionPrice) {
    result.initialConversionPrice = initialConversionPrice;
    autoFilled.push("initialConversionPrice");
  } else {
    failed.push("initialConversionPrice");
  }

  // 최저 전환가
  const minConversionPrice = extractAmount(text, [
    "전환가액의?\\s*조정.{0,30}최저",
    "리픽싱.{0,30}최저",
    "최저\\s*전환가",
  ]);
  if (minConversionPrice) {
    result.minConversionPrice = minConversionPrice;
    autoFilled.push("minConversionPrice");
  } else {
    failed.push("minConversionPrice");
  }

  // 전환 가능 기간
  const conversionStart = extractDate(text, [
    "전환청구기간.{0,10}시작",
    "전환가능기간.{0,10}시작",
    "전환청구\\s*기간",
  ]);
  if (conversionStart) {
    result.conversionStartDate = conversionStart;
    autoFilled.push("conversionStartDate");
  } else {
    failed.push("conversionStartDate");
  }

  const conversionEnd = extractDate(text, [
    "전환청구기간.{0,10}종료",
    "전환가능기간.{0,10}종료",
    "전환청구기간.{0,50}",
  ]);
  if (conversionEnd && conversionEnd !== conversionStart) {
    result.conversionEndDate = conversionEnd;
    autoFilled.push("conversionEndDate");
  } else {
    failed.push("conversionEndDate");
  }

  // 풋옵션
  const putRate = extractPercent(text, [
    "조기상환청구.{0,50}수익률",
    "풋옵션.{0,50}수익률",
    "조기상환\\s*수익률",
  ]);
  if (putRate !== undefined) {
    result.putOptionRate = putRate;
    autoFilled.push("putOptionRate");
  } else {
    failed.push("putOptionRate");
  }

  // 콜옵션 비율
  const callRatio = extractPercent(text, [
    "매도청구권.{0,50}비율",
    "콜옵션.{0,50}비율",
  ]);
  if (callRatio !== undefined) {
    result.callOptionRatio = callRatio;
    autoFilled.push("callOptionRatio");
  } else {
    failed.push("callOptionRatio");
  }

  return { data: result, autoFilledFields: autoFilled, failedFields: failed };
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { url } = await req.json() as { url: string };

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

    // DART 뷰어 URL로 변환하여 크롤링
    const dartViewUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcpNo}`;

    let html: string;
    try {
      const response = await fetch(dartViewUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(10000),
      });
      html = await response.text();
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

    // HTML 태그 제거하여 텍스트 추출
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ");

    const result = parseDisclosureText(text, url);

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "파싱 중 오류가 발생했습니다." }, { status: 500 });
  }
}
