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
 *   회차  매매대금 지급기일  매매가액
 *   1차   YYYY-MM-DD          전자등록금액의 XXX.XXXX%
 *   2차   YYYY-MM-DD          ...
 *   ...
 *   매도청구권 행사 범위 : ... 발행가액의 30% ...
 *   매매가액 산식: ... 연 X.X%의 이율 ...
 */

export interface PutOptionScheduleRow {
  from: string; // YYYY-MM-DD
  to: string;
}

export interface PutCallExtraction {
  putOptionStartDate?: string;
  putOptionEndDate?: string;
  putOptionRate?: number;
  putOptionSchedule?: string; // JSON-stringified PutOptionScheduleRow[]
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
    const mm = parseInt(mo, 10);
    const dd = parseInt(d, 10);
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) dates.push(iso);
  }
  return dates;
}

/**
 * "매도청구권" 이나 "Call Option" 이 여러 번 등장할 수 있음 (목차, 요약, 본문).
 * 실제 내용이 있는 위치를 고르기 위해 각 매칭 지점에서 2000자 뒤에 실제 내용 마커
 * (매매대금, 매매가액, 행사가액, N차, 지급기일) 가 있는지 확인.
 * 없으면 다음 매칭으로.
 */
function findCallSectionStart(text: string): number {
  const re = /매도청구권|Call\s*Option/gi;
  const content = /매매대금|매매가액|매매대금\s*지급|지급\s*기일|행사\s*가액|\d\s*차\s+\d{4}/;
  let m: RegExpExecArray | null;
  let bestIdx = -1;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(m.index, m.index + 3000);
    if (content.test(window)) {
      return m.index; // 첫 번째 실제 내용을 가진 매칭
    }
    if (bestIdx === -1) bestIdx = m.index;
  }
  return bestIdx;
}

/** 정형 API가 못 넘겨준 풋/콜 옵션 필드를 텍스트에서 추출 */
export function extractPutCall(text: string): PutCallExtraction {
  const result: PutCallExtraction = {};

  // ─────────────────────────────────────────────
  // 콜옵션 (매도청구권)
  // ─────────────────────────────────────────────
  const callIdx = findCallSectionStart(text);
  if (callIdx !== -1) {
    // 5000자로 확대 — 표가 만기까지 이어질 수 있고 서두 산문+표가 이어짐
    const callSec = text.slice(callIdx, callIdx + 5000);

    // 1순위: 표 행 패턴 "N차 <date>" — 매매대금 지급기일이 나열되는 표
    // 뒤에 매매가액 %가 오는 경우가 많지만, 필수는 아님
    const rowRe = /(?:\d{1,3}|[제])\s*차\D{0,20}(\d{4})[년\-./\s]{1,3}(\d{1,2})[월\-./\s]{1,3}(\d{1,2})[일]?/g;
    const rowDates: string[] = [];
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(callSec)) !== null) {
      const iso = normalizeDate(rm[1], rm[2], rm[3]);
      const mm = parseInt(rm[2], 10);
      const dd = parseInt(rm[3], 10);
      if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) rowDates.push(iso);
    }

    if (rowDates.length >= 1) {
      result.callOptionStartDate = rowDates[0];
      result.callOptionEndDate = rowDates[rowDates.length - 1];
    } else {
      // 2순위: "매매대금 지급기일" 헤더 뒤 날짜 목록
      const paymentIdx = callSec.search(/매매대금\s*지급\s*기일|지급\s*기일|매매\s*일자/);
      if (paymentIdx !== -1) {
        const payWindow = callSec.slice(paymentIdx, paymentIdx + 2000);
        const dates = extractAllDates(payWindow);
        if (dates.length >= 1) result.callOptionStartDate = dates[0];
        if (dates.length >= 2) result.callOptionEndDate = dates[dates.length - 1];
      } else {
        // 3순위: 서두 산문에 "N개월이 되는 날 YYYY-MM-DD" 형태
        const dates = extractAllDates(callSec);
        if (dates.length >= 2) {
          result.callOptionStartDate = dates[0];
          result.callOptionEndDate = dates[dates.length - 1];
        }
      }
    }

    // 콜옵션 비율: "매도청구권 행사 범위 ... 발행가액의 N%"
    const ratioMatch =
      callSec.match(/행사\s*(?:가능\s*)?범위[^%]{0,300}?([\d.]+)\s*%/) ??
      callSec.match(/(?:권면총액|발행가액|잔액|원금|사채)[^%]{0,60}?의?\s*([\d.]+)\s*%(?:\s*이내|\s*까지|\s*범위)/) ??
      callSec.match(/행사\s*가능.{0,80}?([\d.]+)\s*%/);
    if (ratioMatch) {
      const n = parseFloat(ratioMatch[1]);
      if (Number.isFinite(n) && n <= 100) result.callOptionRatio = n;
    }

    // 콜옵션 금리: "연 N.N%의 이율" — 가장 흔한 표현
    const rateMatch =
      callSec.match(/(?:매매가액|산식|가산)[^%]{0,200}?연\s*([\d.]+)\s*%\s*의?\s*(?:이율|가산)/) ??
      callSec.match(/연\s*([\d.]+)\s*%\s*의?\s*이율/) ??
      callSec.match(/(?:이율|이자율)[^%]{0,50}?연?\s*([\d.]+)\s*%/) ??
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
    // 5000자 넉넉히 스캔 (풋옵션 표는 만기까지 회차가 이어져 여러 페이지 걸침).
    // 근처 다른 표(이자지급, 매도청구권)에서 잘못 잡히는 행은 아래에서 outlier 로 제거.
    const putSec = text.slice(putIdx, putIdx + 5000);

    // 1순위: 표 행 패턴 "N차 <From date> <To date>"
    //   회차 표기: 1차 / 10차 / 100차 / 제1회 / 제N차 / N회차 등 다양한 변형 커버.
    const rowRe = /(?:제\s*)?(?:\d{1,3})\s*(?:차|회차|회)\D{0,20}(\d{4})[년\-./\s]{1,3}(\d{1,2})[월\-./\s]{1,3}(\d{1,2})[일]?[\s\S]{1,40}?(\d{4})[년\-./\s]{1,3}(\d{1,2})[월\-./\s]{1,3}(\d{1,2})[일]?/g;
    const rows: Array<{ from: string; to: string }> = [];
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(putSec)) !== null) {
      const from = normalizeDate(rm[1], rm[2], rm[3]);
      const to = normalizeDate(rm[4], rm[5], rm[6]);
      // 풋옵션 행사기간은 통상 ≤30일. 45일 초과 → 근처 이자지급 표(3개월 짜리)를
      // 잘못 매칭한 것이므로 폐기. 또한 뒤집힌 값(from>to)이나 to-from > 1년도 제외.
      const fromMs = new Date(from).getTime();
      const toMs = new Date(to).getTime();
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;
      const days = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
      if (days < 0 || days > 45) continue;
      rows.push({ from, to });
    }
    // Outlier 제거: 정렬한 뒤 가장 큰 gap 이 6개월 초과이고 전체 span 이 12개월 초과면
    // 이자지급 표 등 다른 섹션에서 잘못 넘어온 행들이라 판단하여 큰 그룹만 남김.
    // 진짜 풋옵션 회차는 3개월 간격의 quorterly cadence 라 큰 gap 이 없음.
    if (rows.length >= 4) {
      const sortedRows = [...rows].sort((a, b) => a.from.localeCompare(b.from));
      const dates = sortedRows.map((r) => new Date(r.from).getTime());
      let maxGap = 0;
      let gapAt = -1;
      for (let i = 1; i < dates.length; i++) {
        const gap = dates[i] - dates[i - 1];
        if (gap > maxGap) {
          maxGap = gap;
          gapAt = i;
        }
      }
      const monthMs = 30 * 24 * 60 * 60 * 1000;
      if (maxGap > 6 * monthMs && dates[dates.length - 1] - dates[0] > 12 * monthMs) {
        const left = sortedRows.slice(0, gapAt);
        const right = sortedRows.slice(gapAt);
        rows = right.length >= left.length ? right : left;
      } else {
        rows = sortedRows;
      }
    }

    if (rows.length > 0) {
      result.putOptionStartDate = rows[0].from;
      result.putOptionEndDate = rows[rows.length - 1].to;
      result.putOptionSchedule = JSON.stringify(rows);
    } else {
      // 2순위 폴백: 표가 없을 때 "조기상환청구기간" 뒤 날짜 목록에서 첫/마지막
      const periodMatch = putSec.match(/조기상환\s*청구\s*기간[^\d]{0,50}/);
      const scanStart = periodMatch ? periodMatch.index! + periodMatch[0].length : 0;
      const nextSecRel = putSec.slice(scanStart).search(/\d{1,2}\.\s*(?:매도|콜|기타|이자|원금|납입)/);
      const scanEnd = nextSecRel === -1 ? putSec.length : scanStart + nextSecRel;
      const trimmed = putSec.slice(scanStart, scanEnd);
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
