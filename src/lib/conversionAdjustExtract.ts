/**
 * 전환가액 조정 공시 본문 파싱.
 *
 * DART "전환가액의 조정" / "전환청구가액의 조정" / "교환가액의 조정" 공시는
 * 별도 정형 API가 없어 텍스트 파싱.
 *
 * 실제 공시 본문의 표기 패턴:
 *   1. 발행에 관한 사항 — 회차: 제3회 무보증사모 전환사채
 *   2. 조정에 관한 사항
 *      가. 조정전 전환가액: 10,000원
 *      나. 조정후 전환가액:  9,500원
 *      다. 조정사유: 시가하락에 따른 리픽싱
 *      라. 조정일: 2026년 8월 20일
 */

export interface ConversionAdjustment {
  seriesNumber: number | null;
  oldPrice: number | null;
  newPrice: number | null;
  adjustedAt: string | null; // YYYY-MM-DD
  reason: string | null;
}

function toNum(s: string | undefined | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pad2(v: number | string): string {
  return String(v).padStart(2, "0");
}

export function extractConversionAdjustment(text: string): ConversionAdjustment {
  const result: ConversionAdjustment = {
    seriesNumber: null,
    oldPrice: null,
    newPrice: null,
    adjustedAt: null,
    reason: null,
  };

  // 회차 — "제 3 회" / "3회차" / "제3회" — 첫 번째 매칭 사용 (본문 서두 발행 정보에 나옴)
  const seriesMatch =
    text.match(/제\s*(\d{1,3})\s*회(?!계)/) ??
    text.match(/(\d{1,3})\s*회\s*차/) ??
    text.match(/회\s*차\s*[:：]?\s*(?:제\s*)?(\d{1,3})/);
  if (seriesMatch) result.seriesNumber = parseInt(seriesMatch[1], 10);

  // 조정후 전환가액 — 여러 표기 커버
  const newPriceMatch =
    text.match(/조정\s*후\s*(?:의?\s*)?(?:전환|교환|청구)?\s*가?액?\s*[:：]?\s*([\d,]+)\s*원/) ??
    text.match(/(?:전환|교환)\s*가액\s*조정\s*후\s*[:：]?\s*([\d,]+)\s*원/) ??
    text.match(/조정\s*후.{0,20}?([\d,]+)\s*원/);
  if (newPriceMatch) result.newPrice = toNum(newPriceMatch[1]);

  // 조정전 전환가액
  const oldPriceMatch =
    text.match(/조정\s*전\s*(?:의?\s*)?(?:전환|교환|청구)?\s*가?액?\s*[:：]?\s*([\d,]+)\s*원/) ??
    text.match(/(?:전환|교환)\s*가액\s*조정\s*전\s*[:：]?\s*([\d,]+)\s*원/) ??
    text.match(/조정\s*전.{0,20}?([\d,]+)\s*원/);
  if (oldPriceMatch) result.oldPrice = toNum(oldPriceMatch[1]);

  // 조정일 / 적용일자 / 조정기준일
  const dateMatch = text.match(
    /(?:조정\s*(?:일|일자|기준일)|적용\s*일자|시행\s*일자)\s*[:：]?\s*(\d{4})[년.\-/\s]{1,3}(\d{1,2})[월.\-/\s]{1,3}(\d{1,2})/,
  );
  if (dateMatch) {
    const [, y, mo, d] = dateMatch;
    result.adjustedAt = `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  // 조정사유 — 한 줄만 얌전히
  const reasonMatch = text.match(/조정\s*사유\s*[:：]?\s*([^\n。.]{5,200})/);
  if (reasonMatch) result.reason = reasonMatch[1].trim().slice(0, 200);

  return result;
}

/** 공시 제목이 전환가액 조정에 해당하는지 판단. Naver 공시 제목 기준. */
export function isAdjustmentDisclosure(title: string): boolean {
  return (
    /(?:전환|교환|청구)\s*가액.{0,10}?조정/.test(title) ||
    /전환가액의?\s*조정/.test(title) ||
    /리픽싱|refixing/i.test(title)
  );
}
