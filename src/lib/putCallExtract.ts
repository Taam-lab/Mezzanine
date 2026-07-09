/**
 * 공시 본문(스크래핑한 텍스트) 에서 풋/콜 옵션 필드를 정규식으로 추출.
 * DART 정형 API에 없는 조항이라 텍스트 파싱 외에는 방법이 없음.
 *
 * 실제 CB/EB 공시(삼보모터스, 에브리봇 등)에서 확인한 패턴 기준:
 *
 * 【조기상환청구권 (풋옵션)】
 *   조기상환청구권 행사 방법 : ...
 *   조기상환청구기간 : YYYY년 MM월 DD일 ~ YYYY년 MM월 DD일
 *   조기상환수익률 : 연 X.X% (또는 "만기수익률과 동일한 이율 연 X.X%")
 *
 * 【매도청구권 (콜옵션)】
 *   매도청구권(Call Option)에 관한 사항
 *   ...
 *   구분 | 매매대금 지급기일 | 매매가액
 *   1차   YYYY-MM-DD          전자등록금액의 XXX.XXXX%
 *   2차   YYYY-MM-DD          ...
 *   ...
 *   매도청구권 행사 범위 : ... 발행가액의 30% ...
 *   매매가액 산식: ... 연 X.X%의 이율 ...
 */

export interface PutCallExtraction {
  putOptionStartDate?: string;
  putOptionEndDate?: string;
  putOptionRate?: number;
  callOptionStartDate?: string;
  callOptionEndDate?: string;
  callOptionRatio?: number;
  callOptionRate?: number;
}

function normalizeDate(y: string, m: string, d: string): string {
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/** 텍스트 슬라이스 안의 모든 날짜(YYYY-MM-DD / YYYY.MM.DD / YYYY년 MM월 DD일)를 순서대로 반환 */
function extractAllDates(text: string): string[] {
  const dates: string[] = [];
  const re = /(\d{4})[년\-./\s]{1,3}(\d{1,2})[월\-./\s]{1,3}(\d{1,2})[일]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [, y, mo, d] = m;
    const iso = normalizeDate(y, mo, d);
    // 유효 날짜만 (월 1-12, 일 1-31)
    const mm = parseInt(mo, 10);
    const dd = parseInt(d, 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) dates.push(iso);
  }
  return dates;
}

/** 정형 API가 못 넘겨준 풋/콜 옵션 필드를 텍스트에서 추출 */
export function extractPutCall(text: string): PutCallExtraction {
  const result: PutCallExtraction = {};

  // ─────────────────────────────────────────────
  // 콜옵션 (매도청구권) — "Call Option" 이 가장 신뢰성 높은 마커
  // ─────────────────────────────────────────────
  const callIdx = text.search(/Call\s*Option|매도청구권/i);
  if (callIdx !== -1) {
    // 매도청구권 섹션은 표(1차~N차)를 포함하므로 넉넉하게 3000자
    const callSec = text.slice(callIdx, callIdx + 3000);

    // 날짜: "매매대금 지급기일" 표에서 첫/마지막 날짜
    const paymentIdx = callSec.search(/매매대금\s*지급\s*기일/);
    if (paymentIdx !== -1) {
      const payWindow = callSec.slice(paymentIdx, paymentIdx + 1500);
      const dates = extractAllDates(payWindow);
      if (dates.length >= 1) result.callOptionStartDate = dates[0];
      if (dates.length >= 2) result.callOptionEndDate = dates[dates.length - 1];
    } else {
      // 표 없이 서두 산문에 "12개월이 되는 날(YYYY-MM-DD)... 24개월이 되는 날(YYYY-MM-DD)" 로 나오는 케이스
      const dates = extractAllDates(callSec);
      if (dates.length >= 2) {
        result.callOptionStartDate = dates[0];
        result.callOptionEndDate = dates[dates.length - 1];
      }
    }

    // 콜옵션 비율: "매도청구권 행사 범위 ... 발행가액의 N%"
    const ratioMatch =
      callSec.match(/행사\s*(?:가능\s*)?범위[^%]{0,200}?([\d.]+)\s*%/) ??
      callSec.match(/(?:권면총액|발행가액|잔액|원금)[^%]{0,40}?의?\s*([\d.]+)\s*%/) ??
      callSec.match(/행사\s*가능.{0,50}?([\d.]+)\s*%/);
    if (ratioMatch) {
      const n = parseFloat(ratioMatch[1]);
      if (Number.isFinite(n) && n <= 100) result.callOptionRatio = n;
    }

    // 콜옵션 금리: "연 N.N%의 이율" — 가장 흔한 표현
    const rateMatch =
      callSec.match(/연\s*([\d.]+)\s*%\s*의?\s*이율/) ??
      callSec.match(/이율[^%]{0,50}?([\d.]+)\s*%/) ??
      callSec.match(/매매가액[^%]{0,300}?연\s*([\d.]+)\s*%/);
    if (rateMatch) {
      const n = parseFloat(rateMatch[1]);
      if (Number.isFinite(n) && n <= 100) result.callOptionRate = n;
    }
  }

  // ─────────────────────────────────────────────
  // 풋옵션 (조기상환청구권)
  // ─────────────────────────────────────────────
  const putIdx = text.search(/조기상환청구권|조기상환\s*청구\s*기간|Put\s*Option/i);
  if (putIdx !== -1) {
    // 조기상환은 3개월마다 청구권 발생하는 표가 만기까지 이어지므로 넉넉하게 5000자
    const putSec = text.slice(putIdx, putIdx + 5000);

    // 시작/종료일: "조기상환청구기간" 뒤 첫 2개의 날짜
    const periodMatch = putSec.match(/조기상환\s*청구\s*기간[^\d]{0,50}/);
    if (periodMatch) {
      const start = periodMatch.index! + periodMatch[0].length;
      // 다음 큰 섹션 헤더 나오기 전까지만 훑음
      const nextSecRel = putSec.slice(start).search(/\d{1,2}\.\s*(?:매도|콜|기타|이자|원금|납입)/);
      const end = nextSecRel === -1 ? putSec.length : start + nextSecRel;
      const dates = extractAllDates(putSec.slice(start, end));
      if (dates.length >= 1) result.putOptionStartDate = dates[0];
      if (dates.length >= 2) result.putOptionEndDate = dates[dates.length - 1];
    } else {
      // 대체: 풋옵션 섹션 전체에서 첫 2개 날짜 (다른 섹션 헤더 전까지)
      const nextSecRel = putSec.search(/\d{1,2}\.\s*(?:매도|콜|기타|이자|원금|납입)/);
      const trimmed = nextSecRel === -1 ? putSec : putSec.slice(0, nextSecRel);
      const dates = extractAllDates(trimmed);
      if (dates.length >= 1) result.putOptionStartDate = dates[0];
      if (dates.length >= 2) result.putOptionEndDate = dates[dates.length - 1];
    }

    // 풋옵션 수익률: "조기상환수익률 : 연 N.N%" 또는 "만기수익률 (연 N.N%)" 표현
    const rateMatch =
      putSec.match(/조기상환\s*(?:수익률|이자율|이율)[^%]{0,60}?([\d.]+)\s*%/) ??
      putSec.match(/보장\s*수익률[^%]{0,60}?([\d.]+)\s*%/) ??
      putSec.match(/연\s*([\d.]+)\s*%\s*의?\s*(?:수익률|이율|이자율)/);
    if (rateMatch) {
      const n = parseFloat(rateMatch[1]);
      if (Number.isFinite(n) && n <= 100) result.putOptionRate = n;
    }
  }

  return result;
}
