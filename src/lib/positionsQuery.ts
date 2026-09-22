import { prisma } from "@/lib/prisma";

/**
 * 보유종목 목록 조회 — API 라우트와 서버 컴포넌트가 같은 select 를 쓰도록 공유.
 *
 * 서버 컴포넌트에서 직접 호출하면 클라이언트가 /api/positions 로 한 번 더
 * 왕복할 필요가 없다 (JS 다운로드 -> 하이드레이션 -> fetch -> 람다 -> DB 대신
 * 서버 렌더 중에 DB 한 번).
 */

/** 클라이언트 컴포넌트로 넘길 수 있는 형태 (BigInt/Date 제거). */
export interface PositionListItem {
  id: string;
  bondCode: string | null;
  assetName: string;
  underlyingTicker: string;
  underlyingCompanyName: string;
  underlyingMarket: string;
  mezzanineType: string;
  investmentType: string;
  investmentAmount: string | null;
  issueDate: string | null;
  maturityDate: string | null;
  currentConversionPrice: number | null;
  putOptionStartDate: string | null;
  putOptionEndDate: string | null;
  putOptionSchedule: string | null;
  isActive: boolean;
}

const LIST_SELECT = {
  id: true,
  bondCode: true,
  assetName: true,
  underlyingTicker: true,
  underlyingCompanyName: true,
  underlyingMarket: true,
  mezzanineType: true,
  investmentType: true,
  investmentAmount: true,
  issueDate: true,
  maturityDate: true,
  currentConversionPrice: true,
  putOptionStartDate: true,
  putOptionEndDate: true,
  putOptionSchedule: true,
  isActive: true,
} as const;

/**
 * RSC 페이로드에는 BigInt 를 담을 수 없고 Date 는 직렬화 왕복에서 형태가 흔들리므로
 * 서버에서 문자열로 확정해 넘긴다. (JSON API 응답과 동일한 모양이 되어
 * 클라이언트 쪽 파싱 로직을 그대로 쓸 수 있다.)
 */
export async function getPositionList(active = true): Promise<PositionListItem[]> {
  const rows = await prisma.position.findMany({
    where: { isActive: active },
    select: LIST_SELECT,
    orderBy: { createdAt: "desc" },
  });

  return rows.map((p) => ({
    ...p,
    investmentAmount: p.investmentAmount === null ? null : p.investmentAmount.toString(),
    issueDate: p.issueDate ? p.issueDate.toISOString() : null,
    maturityDate: p.maturityDate ? p.maturityDate.toISOString() : null,
    putOptionStartDate: p.putOptionStartDate ? p.putOptionStartDate.toISOString() : null,
    putOptionEndDate: p.putOptionEndDate ? p.putOptionEndDate.toISOString() : null,
  }));
}
