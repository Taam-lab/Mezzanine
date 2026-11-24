import { prisma } from "@/lib/prisma";
import type { VfAssetClass } from "@/lib/ventureFundParse";

/**
 * 코벤펀드 화면 데이터. 기준일(월말) 하나를 골라 그날의 모든 펀드 명세부를 읽는다.
 * 금액은 원 단위라 Number 로 바꿔도 정밀도 문제가 없다 (2^53 ≈ 9천조).
 */

export interface VfHoldingItem {
  id: string;
  assetClass: VfAssetClass;
  assetClassRaw: string;
  category: string | null;
  mezzType: string | null;
  name: string;
  code: string | null;
  quantity: number | null;
  price: number | null;
  acquisitionAmount: number | null;
  bookAmount: number | null;
  marketValue: number;
  maturityDate: string | null;
  /** 같은 채권종목번호로 "보유 종목"에 등록된 포지션이 있으면 그 id — 상세 화면으로 연결. */
  positionId: string | null;
}

export interface VfStatementItem {
  id: string;
  fundId: string;
  fundName: string;
  manager: string | null;
  baseDate: string;
  nav: number | null;
  navPerUnit: number | null;
  sourceFileName: string | null;
  uploadedAt: string;
  holdings: VfHoldingItem[];
}

export interface VfFundItem {
  id: string;
  name: string;
  manager: string | null;
  fundCode: string | null;
}

export interface VentureFundsPageData {
  /** 명세부가 있는 기준일, 최신순 (YYYY-MM-DD) */
  dates: string[];
  selectedDate: string | null;
  statements: VfStatementItem[];
  /** 기준일과 무관한 전체 펀드 — 업로드 시 같은 펀드 찾기용 */
  funds: VfFundItem[];
  /** 이미 올라온 명세부 (펀드명·기준일) — 업로드 미리보기에서 "덮어씀" 표시용 */
  uploaded: Array<{ fundName: string; baseDate: string }>;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const toNum = (v: bigint | null) => (v === null ? null : Number(v));
const normCode = (s: string) => s.trim().toUpperCase();

export async function getVentureFundsPageData(date?: string): Promise<VentureFundsPageData> {
  const [allStatements, funds, positions] = await prisma.$transaction([
    prisma.ventureFundStatement.findMany({
      select: { baseDate: true, fund: { select: { name: true } } },
      orderBy: { baseDate: "desc" },
    }),
    prisma.ventureFund.findMany({
      select: { id: true, name: true, manager: true, fundCode: true },
      orderBy: { name: "asc" },
    }),
    prisma.position.findMany({
      where: { isActive: true, bondCode: { not: null } },
      select: { id: true, bondCode: true },
    }),
  ]);

  const uploaded = allStatements.map((s) => ({
    fundName: s.fund.name,
    baseDate: isoDate(s.baseDate),
  }));
  const dates = Array.from(new Set(uploaded.map((u) => u.baseDate)));
  const selectedDate = date && dates.includes(date) ? date : (dates[0] ?? null);
  if (!selectedDate) return { dates, selectedDate, statements: [], funds, uploaded };

  const positionByCode = new Map<string, string>();
  for (const p of positions) if (p.bondCode) positionByCode.set(normCode(p.bondCode), p.id);

  const rows = await prisma.ventureFundStatement.findMany({
    where: { baseDate: new Date(`${selectedDate}T00:00:00Z`) },
    include: {
      fund: { select: { name: true, manager: true } },
      holdings: { orderBy: { seq: "asc" } },
    },
    orderBy: { fund: { name: "asc" } },
  });

  const statements: VfStatementItem[] = rows.map((s) => ({
    id: s.id,
    fundId: s.fundId,
    fundName: s.fund.name,
    manager: s.fund.manager,
    baseDate: isoDate(s.baseDate),
    nav: toNum(s.nav),
    navPerUnit: s.navPerUnit,
    sourceFileName: s.sourceFileName,
    uploadedAt: s.uploadedAt.toISOString(),
    holdings: s.holdings.map((h) => ({
      id: h.id,
      assetClass: h.assetClass as VfAssetClass,
      assetClassRaw: h.assetClassRaw,
      category: h.category,
      mezzType: h.mezzType,
      name: h.name,
      code: h.code,
      quantity: h.quantity,
      price: h.price,
      acquisitionAmount: toNum(h.acquisitionAmount),
      bookAmount: toNum(h.bookAmount),
      marketValue: Number(h.marketValue),
      maturityDate: h.maturityDate ? isoDate(h.maturityDate) : null,
      positionId: h.code ? (positionByCode.get(normCode(h.code)) ?? null) : null,
    })),
  }));

  return { dates, selectedDate, statements, funds, uploaded };
}
