/**
 * 코벤펀드 신탁재산명세부(.xlsx) 파서.
 *
 * 엑셀을 읽는 부분(read-excel-file)과 분리된 순수 함수라서, 브라우저 업로드 화면과
 * 노드 스크립트가 같은 코드를 쓴다. 입력은 시트별 2차원 셀 배열.
 *
 * 운용사마다 명세부 양식이 달라서 두 가지를 지원한다. 열 위치가 아니라 헤더 이름으로
 * 열을 찾으므로 열 순서가 조금 바뀌어도 읽힌다.
 *
 *  - TWO_LINE (예: 마스터자산운용 "신탁재산 통합 명세부")
 *    한 종목이 두 줄. 헤더도 두 줄이다 — 윗줄 "자산구분/펀드/구분/종목/…/장부평가액",
 *    아랫줄 "운용역명/펀드명/발행기관/종목명/…/취득가/손익/시가평가액".
 *    한 파일에 여러 펀드가 있을 수 있어 펀드코드별로 나눈다. 순자산은 "NAV:" 줄.
 *
 *  - FLAT (예: 일자/자산구분/종목명/종목코드/수량/…/장부가액/평가액/취득액 표)
 *    한 종목이 한 줄. "소계"/"전체합계" 줄은 건너뛴다. 순자산은 "순자산" 열.
 *    펀드명이 파일 안에 없어서 파일명에서 추정하고, 펀드코드는 시트명에서 가져온다.
 */

/**
 * 저장용 자산군. 화면은 이것을 채권(MEZZ·BOND)/주식/기타자산 셋으로 묶어 보여준다
 * (VentureFundsClient). 원본 분류를 남겨 두면 표시 방식을 바꿔도 다시 올릴 필요가 없다.
 */
export type VfAssetClass = "STOCK" | "MEZZ" | "BOND" | "CASH" | "DERIV" | "OTHER";

export type VfSourceFormat = "TWO_LINE" | "FLAT";

export interface ParsedHolding {
  assetClass: VfAssetClass;
  assetClassRaw: string;
  category: string | null;
  mezzType: string | null;
  name: string;
  code: string | null;
  quantity: number | null;
  price: number | null;
  /** 취득원가 — 화면의 "보유금액". */
  acquisitionAmount: number | null;
  bookAmount: number | null;
  /** 평가금액. 미지급보수 같은 부채성 항목은 음수로 넣어 합계가 순자산과 맞게 한다. */
  marketValue: number;
  /** YYYY-MM-DD */
  maturityDate: string | null;
}

export interface ParsedStatement {
  format: VfSourceFormat;
  sheetName: string;
  /** YYYY-MM-DD */
  baseDate: string;
  fundCode: string | null;
  /** 파일 안에 펀드명이 있으면 그 값, 없으면 파일명에서 추정한 값. */
  fundName: string | null;
  manager: string | null;
  nav: number | null;
  navPerUnit: number | null;
  holdings: ParsedHolding[];
}

export interface SheetInput {
  sheet: string;
  data: unknown[][];
}

export interface ParseResult {
  statements: ParsedStatement[];
  errors: string[];
}

// ─── 셀 값 헬퍼 ─────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** 헤더 비교용: 공백·줄바꿈 제거. "구    분" → "구분", "예탁원종목\r\n" → "예탁원종목". */
function norm(v: unknown): string {
  return str(v).replace(/\s+/g, "");
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = str(v).replace(/,/g, "");
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/** 금액은 원 단위 정수로. */
function amount(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.round(n);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** "2026.10.31", "2026-10-31", Date → "2026-10-31". 그 밖은 null. */
function toIsoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getUTCFullYear()}-${pad2(v.getUTCMonth() + 1)}-${pad2(v.getUTCDate())}`;
  }
  const m = str(v).match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** 만기일: 예금의 "2999-12-31" 같은 자리채움 값은 버린다. */
function toMaturity(v: unknown): string | null {
  const d = toIsoDate(v);
  if (!d) return null;
  const y = Number(d.slice(0, 4));
  return y >= 2000 && y < 2200 ? d : null;
}

function findCol(row: unknown[] | undefined, name: string): number {
  if (!row) return -1;
  const target = norm(name);
  return row.findIndex((v) => norm(v) === target);
}

function cell(row: unknown[] | undefined, col: number): unknown {
  return row && col >= 0 ? row[col] : undefined;
}

/** "NAV:" 같은 라벨 오른쪽에서 처음 나오는 숫자. */
function numberRightOf(row: unknown[], col: number): number | null {
  for (let i = col + 1; i < row.length; i++) {
    const n = num(row[i]);
    if (n !== null) return n;
  }
  return null;
}

// ─── 자산 분류 ──────────────────────────────────────────────────────────────

function detectBondMezz(name: string): string | null {
  const m =
    name.match(/(CB|EB|BW)(\s*\(.*\))?\s*$/i) ?? name.match(/\d\s*(CB|EB|BW)(?![A-Z])/i);
  if (m) return m[1].toUpperCase();
  if (/전환사채/.test(name)) return "CB";
  if (/교환사채/.test(name)) return "EB";
  if (/신주인수권/.test(name)) return "BW";
  return null;
}

function detectStockMezz(name: string): string | null {
  if (/RCPS|상환전환우선/i.test(name)) return "RCPS";
  if (/\bCPS\b|전환우선/i.test(name)) return "CPS";
  return null;
}

function classify(
  rawClass: string,
  name: string,
): { assetClass: VfAssetClass; mezzType: string | null } {
  const r = rawClass.replace(/\s+/g, "");
  if (/스왑|선물|옵션|파생/.test(r)) return { assetClass: "DERIV", mezzType: null };
  if (/REPO|현금|예금|예치|콜론/i.test(r)) return { assetClass: "CASH", mezzType: null };
  // 전자단기사채는 만기 한두 달짜리라 사실상 현금성.
  if (/전단채/.test(r) || /\(단\)\s*$/.test(name)) return { assetClass: "CASH", mezzType: null };
  if (/채권|사채/.test(r)) {
    const mezz = detectBondMezz(name);
    return mezz ? { assetClass: "MEZZ", mezzType: mezz } : { assetClass: "BOND", mezzType: null };
  }
  if (/주식|ETF|수익증권/i.test(r)) {
    const mezz = detectStockMezz(name);
    return mezz ? { assetClass: "MEZZ", mezzType: mezz } : { assetClass: "STOCK", mezzType: null };
  }
  return { assetClass: "OTHER", mezzType: null };
}

/** 미지급보수 등 부채성 기타 항목. 명세부에는 양수로 적혀 있다. */
function isLiability(name: string): boolean {
  return /^(미지급|선수|예수)/.test(name.replace(/\s+/g, ""));
}

function makeHolding(args: {
  rawClass: string;
  category: string;
  name: string;
  code: string;
  quantity: number | null;
  price: number | null;
  acquisitionAmount: number | null;
  bookAmount: number | null;
  marketValue: number | null;
  maturity: unknown;
}): ParsedHolding {
  const { assetClass, mezzType } = classify(args.rawClass, args.name);
  let mv = args.marketValue ?? 0;
  if (assetClass === "OTHER" && isLiability(args.name)) mv = -Math.abs(mv);
  const hasMaturity = assetClass === "MEZZ" || assetClass === "BOND";
  return {
    assetClass,
    assetClassRaw: args.rawClass,
    category: args.category || null,
    mezzType,
    name: args.name,
    code: args.code || null,
    quantity: args.quantity,
    price: args.price !== null && args.price > 0 ? args.price : null,
    acquisitionAmount: args.acquisitionAmount,
    bookAmount: args.bookAmount,
    marketValue: mv,
    maturityDate: hasMaturity ? toMaturity(args.maturity) : null,
  };
}

// ─── 파일명 → 펀드명 추정 ──────────────────────────────────────────────────

const FILENAME_NOISE =
  /신탁재산|통합|명세부|명세서|보유현황|보유종목|종목별|월말|기준|코스닥벤처|코벤/g;

export function fundNameFromFileName(fileName: string): string | null {
  let s = fileName.replace(/\.[^.]+$/, "");
  s = s.replace(/(^|[_\s-])\d{6,8}(?=$|[_\s-])/g, " ");
  s = s.replace(FILENAME_NOISE, " ");
  s = s.replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

/** 시트명이 펀드코드처럼 생겼으면 그대로 쓴다 ("2205"). "Sheet1" 같은 기본 이름은 제외. */
function fundCodeFromSheetName(sheet: string): string | null {
  const s = sheet.trim();
  if (!/^[0-9A-Za-z_-]{2,20}$/.test(s)) return null;
  if (/^sheet\d*$/i.test(s)) return null;
  return s;
}

// ─── TWO_LINE ───────────────────────────────────────────────────────────────

function parseTwoLine(s: SheetInput): ParsedStatement[] | null {
  const data = s.data;
  let h = -1;
  for (let r = 0; r < Math.min(data.length - 1, 40); r++) {
    if (
      findCol(data[r], "자산구분") >= 0 &&
      findCol(data[r + 1], "운용역명") >= 0 &&
      findCol(data[r + 1], "시가평가액") >= 0
    ) {
      h = r;
      break;
    }
  }
  if (h < 0) return null;

  const H1 = data[h];
  const H2 = data[h + 1];
  const c = {
    cls: findCol(H1, "자산구분"),
    fundCode: findCol(H1, "펀드"),
    category: findCol(H1, "구분"),
    code: findCol(H1, "종목"),
    qty: findCol(H1, "주수/계약수/액면"),
    price: findCol(H1, "행사가격/종가"),
    book: findCol(H1, "장부평가액"),
    fundName: findCol(H2, "펀드명"),
    name: findCol(H2, "종목명"),
    acq: findCol(H2, "취득가"),
    mv: findCol(H2, "시가평가액"),
    maturity: findCol(H2, "상환일"),
    unitPrice: findCol(H2, "적용단가"),
  };
  const missing = Object.entries({
    자산구분: c.cls,
    펀드: c.fundCode,
    종목명: c.name,
    시가평가액: c.mv,
  })
    .filter(([, i]) => i < 0)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`[${s.sheet}] 필수 열을 찾지 못했습니다: ${missing.join(", ")}`);
  }

  // 머리말: 운용사명, 기준일
  let baseDate: string | null = null;
  let manager: string | null = null;
  for (let r = 0; r < h; r++) {
    for (const v of data[r]) {
      const t = str(v);
      if (!t) continue;
      if (!baseDate) baseDate = toIsoDate(t);
      if (!manager && /운용|자산|투자/.test(t) && !/명세|신탁재산|[:：]/.test(t)) manager = t;
    }
  }

  const funds = new Map<string, { fundName: string | null; holdings: ParsedHolding[] }>();
  const navs = new Map<string, { nav: number | null; navPerUnit: number | null }>();
  let lastNavFund: string | null = null;

  for (let r = h + 2; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;

    // 펀드 합계: "000006 | NAV: | 2,598,350,279 ..." 다음 줄 "기준가: | 1039.37"
    const navCol = row.findIndex((v) => norm(v) === "NAV:");
    if (navCol >= 0) {
      const code = str(row[0]) || str(row[c.fundCode]);
      navs.set(code, { nav: numberRightOf(row, navCol), navPerUnit: null });
      lastNavFund = code;
      continue;
    }
    const bpCol = row.findIndex((v) => norm(v) === "기준가:");
    if (bpCol >= 0) {
      const entry = lastNavFund ? navs.get(lastNavFund) : undefined;
      if (entry) entry.navPerUnit = numberRightOf(row, bpCol);
      continue;
    }

    // 종목 첫 줄: 자산구분 칸에 글자, 펀드 칸에 펀드코드(공백·한글 없음).
    // 소계 줄은 자산구분 칸에 펀드코드가 들어 있고, 둘째 줄은 펀드 칸에 펀드명이 있어 걸러진다.
    const rawClass = str(row[c.cls]);
    const fundCode = str(row[c.fundCode]);
    if (!rawClass || /^\d+$/.test(rawClass)) continue;
    if (!/^[0-9A-Za-z_-]+$/.test(fundCode)) continue;
    const line2 = data[r + 1];
    const name = str(cell(line2, c.name));
    if (!name) continue;
    r++; // 둘째 줄까지 소비

    const price = num(cell(row, c.price));
    const unitPrice = num(cell(line2, c.unitPrice));
    const fund = funds.get(fundCode) ?? {
      fundName: str(cell(line2, c.fundName)) || null,
      holdings: [],
    };
    fund.holdings.push(
      makeHolding({
        rawClass,
        category: str(cell(row, c.category)),
        name,
        code: str(cell(row, c.code)),
        quantity: num(cell(row, c.qty)),
        price: price && price > 0 ? price : unitPrice,
        acquisitionAmount: amount(cell(line2, c.acq)),
        bookAmount: amount(cell(row, c.book)),
        marketValue: amount(cell(line2, c.mv)),
        maturity: cell(line2, c.maturity),
      }),
    );
    funds.set(fundCode, fund);
  }

  if (funds.size === 0) return [];
  if (!baseDate) throw new Error(`[${s.sheet}] 기준일을 찾지 못했습니다.`);

  return Array.from(funds.entries()).map(([fundCode, f]) => ({
    format: "TWO_LINE" as const,
    sheetName: s.sheet,
    baseDate: baseDate!,
    fundCode,
    fundName: f.fundName,
    manager,
    nav: navs.get(fundCode)?.nav ?? null,
    navPerUnit: navs.get(fundCode)?.navPerUnit ?? null,
    holdings: f.holdings,
  }));
}

// ─── FLAT ───────────────────────────────────────────────────────────────────

const SUBTOTAL_NAME = /^(소계|합계|전체합계|총계|자산합계)$/;

function parseFlat(s: SheetInput, fileName: string): ParsedStatement | null {
  const data = s.data;
  let h = -1;
  for (let r = 0; r < Math.min(data.length, 30); r++) {
    if (
      findCol(data[r], "자산구분") >= 0 &&
      findCol(data[r], "종목명") >= 0 &&
      findCol(data[r], "평가액") >= 0
    ) {
      h = r;
      break;
    }
  }
  if (h < 0) return null;

  const H = data[h];
  const c = {
    date: findCol(H, "일자"),
    cls: findCol(H, "자산구분"),
    name: findCol(H, "종목명"),
    code: findCol(H, "종목코드"),
    qty: findCol(H, "수량"),
    book: findCol(H, "장부가액"),
    mv: findCol(H, "평가액"),
    acq: findCol(H, "취득액"),
    price: findCol(H, "종가"),
    maturity: findCol(H, "만기일"),
    category: findCol(H, "자산분류"),
    nav: findCol(H, "순자산"),
    navPerUnit: findCol(H, "기준가격"),
    fundName: findCol(H, "펀드명"),
    fundCode: findCol(H, "펀드코드"),
  };

  let baseDate: string | null = null;
  let nav: number | null = null;
  let navPerUnit: number | null = null;
  let fundName: string | null = null;
  let fundCode: string | null = null;
  const holdings: ParsedHolding[] = [];

  for (let r = h + 1; r < data.length; r++) {
    const row = data[r];
    if (!row) continue;
    const name = str(row[c.name]);
    const rawClass = str(row[c.cls]);
    if (!baseDate) baseDate = toIsoDate(cell(row, c.date));
    if (nav === null) {
      const n = amount(cell(row, c.nav));
      if (n) nav = n;
    }
    if (navPerUnit === null) {
      const n = num(cell(row, c.navPerUnit));
      if (n) navPerUnit = n;
    }
    if (!fundName) fundName = str(cell(row, c.fundName)) || null;
    if (!fundCode) fundCode = str(cell(row, c.fundCode)) || null;

    if (!name || !rawClass || SUBTOTAL_NAME.test(name.replace(/\s+/g, ""))) continue;

    holdings.push(
      makeHolding({
        rawClass,
        category: str(cell(row, c.category)),
        name,
        code: str(cell(row, c.code)),
        quantity: num(cell(row, c.qty)),
        price: num(cell(row, c.price)),
        acquisitionAmount: amount(cell(row, c.acq)),
        bookAmount: amount(cell(row, c.book)),
        marketValue: amount(cell(row, c.mv)),
        maturity: cell(row, c.maturity),
      }),
    );
  }

  if (holdings.length === 0) return null;
  if (!baseDate) {
    const m = fileName.match(/(20\d{2})(\d{2})(\d{2})/);
    if (m) baseDate = toIsoDate(`${m[1]}-${m[2]}-${m[3]}`);
  }
  if (!baseDate) throw new Error(`[${s.sheet}] 기준일(일자)을 찾지 못했습니다.`);

  return {
    format: "FLAT",
    sheetName: s.sheet,
    baseDate,
    fundCode: fundCode ?? fundCodeFromSheetName(s.sheet),
    fundName: fundName ?? fundNameFromFileName(fileName),
    manager: null,
    nav,
    navPerUnit,
    holdings,
  };
}

// ─── 진입점 ─────────────────────────────────────────────────────────────────

const addNullable = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

/**
 * 같은 종목의 매입 회차별 줄(예: 알테오젠 1,157주 + 419주)을 한 줄로 합친다.
 * 종목코드가 다르면(스왑 계약 두 건 등) 따로 둔다.
 */
function mergeLots(holdings: ParsedHolding[]): ParsedHolding[] {
  const byKey = new Map<string, ParsedHolding>();
  for (const h of holdings) {
    const key = `${h.assetClass}|${h.code ?? h.name}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...h });
      continue;
    }
    prev.quantity = addNullable(prev.quantity, h.quantity);
    prev.acquisitionAmount = addNullable(prev.acquisitionAmount, h.acquisitionAmount);
    prev.bookAmount = addNullable(prev.bookAmount, h.bookAmount);
    prev.marketValue += h.marketValue;
    prev.price = prev.price ?? h.price;
    prev.maturityDate = prev.maturityDate ?? h.maturityDate;
  }
  return Array.from(byKey.values());
}

export function parseVentureFundStatement(fileName: string, sheets: SheetInput[]): ParseResult {
  const statements: ParsedStatement[] = [];
  const errors: string[] = [];

  for (const s of sheets) {
    try {
      const twoLine = parseTwoLine(s);
      if (twoLine) {
        statements.push(...twoLine);
        continue;
      }
      const flat = parseFlat(s, fileName);
      if (flat) statements.push(flat);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  for (const st of statements) st.holdings = mergeLots(st.holdings);

  if (statements.length === 0 && errors.length === 0) {
    errors.push("명세부 양식을 알아보지 못했습니다. 보유종목 표의 헤더(자산구분·종목명·평가액)를 찾을 수 없습니다.");
  }
  return { statements, errors };
}

/** 보유종목 평가금액 합계 (부채성 항목 포함). */
export function sumMarketValue(holdings: Pick<ParsedHolding, "marketValue">[]): number {
  return holdings.reduce((a, h) => a + h.marketValue, 0);
}
