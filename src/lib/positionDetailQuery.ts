import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * 종목 상세 조회 — 상세 페이지(서버 컴포넌트)와 GET /api/positions/[id] 가 공유한다.
 *
 * 관계 5개를 findUnique 한 번의 include 로 읽는다. schema.prisma 의 relationJoins 로
 * 이게 SQL 한 문장이 된다. 예전처럼 관계마다 findMany 를 Promise.all 로 날리면
 * DATABASE_URL 의 connection_limit=1 때문에 어차피 직렬로 돌고, pgbouncer=true 모드는
 * 쿼리마다 BEGIN/DEALLOCATE/COMMIT 을 덧붙여서 7쿼리 = 25문장이었다
 * (로컬 100ms RTT 기준 3.3s → 0.55s).
 *
 * 상세 화면이 렌더하지 않는 owner 조인과 컬럼(disclosure.parsedData 등)은 읽지 않는다.
 */
const DETAIL_INCLUDE = {
  // checkId 별 최신 1건
  riskCheckResults: {
    select: { checkId: true, status: true, checkedAt: true },
    orderBy: { checkedAt: "desc" },
    distinct: ["checkId"],
  },
  disclosures: {
    select: { id: true, reportName: true, severity: true, filedAt: true, dartUrl: true },
    orderBy: { filedAt: "desc" },
    take: 20,
  },
  newsItems: {
    select: { id: true, title: true, source: true, sourceUrl: true, publishedAt: true },
    orderBy: { publishedAt: "desc" },
    take: 20,
  },
  conversionPriceHistory: {
    select: {
      id: true,
      oldPrice: true,
      newPrice: true,
      adjustmentReason: true,
      adjustedAt: true,
      isAutomatic: true,
    },
    orderBy: { adjustedAt: "asc" },
  },
} satisfies Prisma.PositionInclude;

/** 클라이언트로 넘기는 모양 — API JSON 응답과 동일 (BigInt·Date 는 문자열). */
export interface PositionDetail {
  id: string;
  bondCode: string | null;
  assetName: string;
  underlyingTicker: string;
  underlyingCompanyName: string;
  underlyingMarket: string;
  mezzanineType: string;
  issueDate: string | null;
  investmentType: string;
  investmentAmount: string | null;
  maturityDate: string | null;
  couponRate: number | null;
  ytm: number | null;
  initialConversionPrice: number | null;
  minConversionPrice: number | null;
  currentConversionPrice: number | null;
  conversionStartDate: string | null;
  conversionEndDate: string | null;
  putOptionRate: number | null;
  putOptionStartDate: string | null;
  putOptionEndDate: string | null;
  putOptionSchedule: string | null;
  callOptionRatio: number | null;
  callOptionRate: number | null;
  callOptionStartDate: string | null;
  callOptionEndDate: string | null;
  seriesNumber: number | null;
  sourceDisclosureUrl: string | null;
  note: string | null;
  priceSnapshots: Array<{ id: string; price: number; changeRate: number | null; snapshotAt: string }>;
  conversionPriceHistory: Array<{
    id: string;
    oldPrice: number;
    newPrice: number;
    adjustmentReason: string | null;
    adjustedAt: string;
    isAutomatic: boolean;
  }>;
  riskCheckResults: Array<{ checkId: string; status: string; checkedAt: string }>;
  disclosures: Array<{
    id: string;
    reportName: string;
    severity: string;
    filedAt: string;
    dartUrl: string | null;
  }>;
  newsItems: Array<{
    id: string;
    title: string;
    source: string | null;
    sourceUrl: string;
    publishedAt: string;
  }>;
}

/**
 * Prisma 결과를 JSON 으로 한 번 왕복시켜 BigInt → 문자열(prisma.ts 의 toJSON),
 * Date → ISO 문자열로 확정한다. API 응답과 서버 컴포넌트 props 가 같은 모양이 된다.
 */
function toPlain<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * 주가 차트용: KST 날짜별 마지막 스냅샷 1건씩, 최근 30일치 (최신순).
 *
 * 예전엔 "최근 스냅샷 30건"이었는데, 스냅샷은 워커가 장중 5분마다, 상세 화면이
 * 열릴 때마다 쌓는다. 그래서 30건이 대부분 같은 날의 몇 분 간격 값이었고, x축 라벨
 * (MM/DD)이 같은 날짜로 줄줄이 찍혔다. snapshot_at 은 UTC 로 저장되므로 KST 로
 * 바꿔서 날짜를 자른다. 첫 행은 여전히 가장 최근 스냅샷이다 (현재가 폴백용).
 */
function dailySnapshotsQuery(positionId: string) {
  return prisma.$queryRaw<
    Array<{ id: string; price: number; changeRate: number | null; snapshotAt: Date }>
  >`
    SELECT DISTINCT ON ((snapshot_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date)
           id, price, change_rate AS "changeRate", snapshot_at AS "snapshotAt"
      FROM price_snapshots
     WHERE position_id = ${positionId}
       AND snapshot_at >= (now() AT TIME ZONE 'UTC') - interval '45 days'
     ORDER BY (snapshot_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date DESC,
              snapshot_at DESC
     LIMIT 30`;
}

export async function getPositionDetail(id: string): Promise<PositionDetail | null> {
  // 배치 트랜잭션 하나로 묶어 pgbouncer 래핑(BEGIN/DEALLOCATE/COMMIT)을 한 번만 탄다.
  const [row, priceSnapshots] = await prisma.$transaction([
    prisma.position.findUnique({ where: { id }, include: DETAIL_INCLUDE }),
    dailySnapshotsQuery(id),
  ]);
  return row ? toPlain<PositionDetail>({ ...row, priceSnapshots }) : null;
}

/** 수정 폼용 — 관계 없이 종목 행 하나만. */
export async function getPositionForEdit(
  id: string,
): Promise<Omit<PositionDetail, "priceSnapshots" | "conversionPriceHistory" | "riskCheckResults" | "disclosures" | "newsItems"> | null> {
  const row = await prisma.position.findUnique({ where: { id } });
  return row ? toPlain(row) : null;
}
