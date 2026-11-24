import { prisma } from "@/lib/prisma";
import type { VfAssetClass } from "@/lib/ventureFundParse";

/**
 * 코벤펀드 화면 데이터. 펀드마다 가장 최근 명세부 한 장만 저장돼 있으므로
 * 펀드 목록 + 각 펀드의 보유종목을 한 번에 읽는다.
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

export interface VfFundItem {
  id: string;
  name: string;
  manager: string | null;
  fundCode: string | null;
  /** 명세부 기준일 YYYY-MM-DD */
  baseDate: string;
  nav: number | null;
  navPerUnit: number | null;
  sourceFileName: string | null;
  holdings: VfHoldingItem[];
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const toNum = (v: bigint | null) => (v === null ? null : Number(v));
const normCode = (s: string) => s.trim().toUpperCase();

export async function getVentureFunds(): Promise<VfFundItem[]> {
  const [funds, positions] = await prisma.$transaction([
    prisma.ventureFund.findMany({
      include: { holdings: { orderBy: { seq: "asc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.position.findMany({
      where: { isActive: true, bondCode: { not: null } },
      select: { id: true, bondCode: true },
    }),
  ]);

  const positionByCode = new Map<string, string>();
  for (const p of positions) if (p.bondCode) positionByCode.set(normCode(p.bondCode), p.id);

  return funds.map((f) => ({
    id: f.id,
    name: f.name,
    manager: f.manager,
    fundCode: f.fundCode,
    baseDate: isoDate(f.baseDate),
    nav: toNum(f.nav),
    navPerUnit: f.navPerUnit,
    sourceFileName: f.sourceFileName,
    holdings: f.holdings.map((h) => ({
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
}
