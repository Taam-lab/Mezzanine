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
  // 매도청구권(EB/CB) / 중도상환청구권(무학 EB) / Call Option 모두 커버.
  const re = /매도청구권|중도상환청구권|Call\s*Option/gi;
  const content = /매매대금|매매가액|매매대금\s*지급|지급\s*기일|행사\s*가액|중도상환|만기\s*\d+개월\s*전|\d\s*차\s+\d{4}/;
  let m: RegExpExecArray | null;
  let bestIdx = -1;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(m.index, m.index + 3000);
    if (content.test(window)) {
      return m.index;
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
  // 콜옵션 앵커: "매도청구권 행사/청구기간" 또는 "중도상환청구권" (무학 EB 스타일).
  const callAnchorRe = /매도청구권\s*(?:행사|청구)\s*기간/;
  const callAnchorMatch = callAnchorRe.exec(text);
  const callIdx = callAnchorMatch ? callAnchorMatch.index : findCallSectionStart(text);
  if (callIdx !== -1) {
    const callSec = callAnchorMatch
      ? text.slice(callIdx, callIdx + 1500)
      : text.slice(callIdx, callIdx + 2500);

    // 1순위: 산문형 "(YYYY년 MM월 DD일)부터 ... (YYYY년 MM월 DD일)까지" 패턴
    //   무학처럼 "36개월이 되는 날(2028년 10월 28일)부터 만기 1개월 전일(2030년 9월 28일)까지"
    //   같은 구조는 이 패턴으로 정확히 잡힘. 다른 dates (이사회결의일/납입일 등) 오탐 방지.
    const proseMatch = callSec.match(
      /\((\d{4})[년.\-/\s]+(\d{1,2})[월.\-/\s]+(\d{1,2})[일)]{1,2}\s*부터[^(]{0,150}?\((\d{4})[년.\-/\s]+(\d{1,2})[월.\-/\s]+(\d{1,2})[일)]{1,2}\s*(?:까지|의)/,
    );
    if (proseMatch) {
      const from = `${proseMatch[1]}-${proseMatch[2].padStart(2, "0")}-${proseMatch[3].padStart(2, "0")}`;
      const to = `${proseMatch[4]}-${proseMatch[5].padStart(2, "0")}-${proseMatch[6].padStart(2, "0")}`;
      // 뒤집힘 방어
      if (from > to) {
        result.callOptionStartDate = to;
        result.callOptionEndDate = from;
      } else {
        result.callOptionStartDate = from;
        result.callOptionEndDate = to;
      }
    } else {
      // 2순위: callSec 안 모든 날짜 sort → min/max
      const dates = extractAllDates(callSec);
      if (dates.length >= 2) {
        const sorted = [...dates].sort();
        result.callOptionStartDate = sorted[0];
        result.callOptionEndDate = sorted[sorted.length - 1];
      } else if (dates.length === 1) {
        result.callOptionStartDate = dates[0];
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
    let rows: Array<{ from: string; to: string }> = [];
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
    // Cadence 기반 클러스터링:
    //   진짜 풋옵션 회차는 quarterly (~90일) 간격. 정렬한 뒤 successive gap 이
    //   [60, 120]일 범위 안에 있는 연속 구간을 그룹으로 묶고, 가장 큰 그룹만 남김.
    //   → 마이크로디지탈 케이스: 이자표 5행 (quarterly) + 실제 풋 12행 (quarterly)
    //     사이의 gap 이 30일이라 max-gap 로직으로는 못 잡음. 이 짧은 gap 이 두 표의
    //     경계라는 걸 여기서 감지.
    if (rows.length >= 4) {
      const sortedRows = [...rows].sort((a, b) => a.from.localeCompare(b.from));
      const dayMs = 24 * 60 * 60 * 1000;
      const dates = sortedRows.map((r) => new Date(r.from).getTime());
      const groups: number[][] = [];
      let current: number[] = [0];
      for (let i = 1; i < dates.length; i++) {
        const gapDays = Math.round((dates[i] - dates[i - 1]) / dayMs);
        // 60~120일: quarterly 허용 범위 (2월 짧은달 포함 89일 ~ 3월 92일 커버).
        // 그 외 gap 은 표 경계로 판단.
        if (gapDays >= 60 && gapDays <= 120) {
          current.push(i);
        } else {
          groups.push(current);
          current = [i];
        }
      }
      groups.push(current);
      // 가장 큰 그룹만 유지. 동률이면 뒤쪽 (미래) 그룹 우선 — 이자표는 통상 앞에 오고
      // 풋옵션은 뒤에 오므로 tiebreak 로 뒤 유리.
      groups.sort((a, b) =>
        b.length !== a.length ? b.length - a.length : b[0] - a[0],
      );
      const keep = new Set(groups[0]);
      rows = sortedRows.filter((_, i) => keep.has(i));
    }

    // 대안 표 형식: "지급일 FROM TO {전자등록금액|N.NNN%}" 3열 (SK케미칼/무학 EB 스타일).
    // 3개 연속 날짜 뒤에 마커 (전자등록금액/권면총액/사채원금/사채금액) 또는 백분율 이 오는 패턴.
    if (rows.length === 0) {
      const threeColRe =
        /(\d{4})[년\-./\s]{1,3}(\d{1,2})[월\-./\s]{1,3}(\d{1,2})[일]?\s+(\d{4})[년\-./\s]{1,3}(\d{1,2})[월\-./\s]{1,3}(\d{1,2})[일]?\s+(\d{4})[년\-./\s]{1,3}(\d{1,2})[월\-./\s]{1,3}(\d{1,2})[일]?\s*(?:전자등록금액|권면총액|사채원금|사채금액|[\d.]+\s*%)/g;
      let m: RegExpExecArray | null;
      while ((m = threeColRe.exec(putSec)) !== null) {
        const from = normalizeDate(m[4], m[5], m[6]);
        const to = normalizeDate(m[7], m[8], m[9]);
        const fromMs = new Date(from).getTime();
        const toMs = new Date(to).getTime();
        if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) continue;
        const days = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
        if (days < 0 || days > 45) continue;
        rows.push({ from, to });
      }
    }

    if (rows.length > 0) {
      result.putOptionStartDate = rows[0].from;
      result.putOptionEndDate = rows[rows.length - 1].to;
      result.putOptionSchedule = JSON.stringify(rows);
    } else {
      // 2순위 폴백: 표 매칭 실패 시 "조기상환청구권 행사기간" 앵커부터 좁게 스캔.
      // 콜 옵션과 대칭 구조 — 앵커 뒤 1500자 안 날짜를 sort 후 min/max.
      const putAnchorRe = /조기상환청구권\s*(?:행사|청구)\s*기간|조기상환\s*청구\s*기간/;
      const putAnchorMatch = putAnchorRe.exec(putSec);
      const scanStart = putAnchorMatch
        ? putAnchorMatch.index + putAnchorMatch[0].length
        : 0;
      const nextSecRel = putSec
        .slice(scanStart)
        .search(/\d{1,2}\.\s*(?:매도|콜|기타|이자|원금|납입)/);
      const scanEnd =
        nextSecRel === -1
          ? Math.min(putSec.length, scanStart + 1500)
          : Math.min(scanStart + nextSecRel, scanStart + 1500);
      const trimmed = putSec.slice(scanStart, scanEnd);
      const dates = extractAllDates(trimmed).sort();
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
