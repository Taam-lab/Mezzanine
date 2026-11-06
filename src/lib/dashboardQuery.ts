import { prisma } from "@/lib/prisma";
import {
  positionListQuery,
  toPositionListItems,
  type PositionListItem,
} from "@/lib/positionsQuery";

/**
 * 대시보드가 첫 화면에 필요로 하는 DB 데이터.
 *
 * 시세(네이버)·뉴스(구글/DART) 같은 외부 API 는 여기 넣지 않는다.
 * 느린 서드파티를 기다리느라 HTML 전송이 늦어지면 오히려 손해라서,
 * DB 에서 즉시 읽히는 것만 서버 렌더에 싣고 외부 데이터는 클라이언트가 이어서 채운다.
 */

export interface DashboardAlert {
  id: string;
  title: string;
  severity: string;
  createdAt: string;
  sourceUrl: string | null;
  metadata: string | null;
}

/**
 * 최근 알림. alerts_created_at_idx (created_at DESC) 를 그대로 타므로
 * 정렬 비용 없이 상위 N 건만 읽는다.
 *
 * 읽기 전용이라 getDefaultUserId() 를 호출하지 않는다 — 그 헬퍼는 upsert 라
 * 페이지 렌더 경로에 불필요한 쓰기 왕복을 추가한다. 대시보드는 읽음/안읽음
 * 상태를 쓰지 않으므로 userStatuses 조인도 생략.
 */
function dashboardAlertsQuery(limit: number) {
  return prisma.alert.findMany({
    select: {
      id: true,
      title: true,
      severity: true,
      createdAt: true,
      sourceUrl: true,
      metadata: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/**
 * 대시보드 첫 화면 데이터(활성 종목 + 최근 알림)를 한 번에.
 *
 * 두 쿼리를 Promise.all 로 날려도 DATABASE_URL 의 connection_limit=1 때문에 직렬이고,
 * pgbouncer=true 모드는 쿼리마다 BEGIN/DEALLOCATE/COMMIT 을 따로 감싼다 (8문장).
 * 배치 $transaction 으로 묶으면 그 래핑을 한 번만 해서 5문장이 된다
 * (로컬 100ms RTT 기준 1.1s → 0.8s).
 */
export async function getDashboardData(alertLimit = 20): Promise<{
  positions: PositionListItem[];
  alerts: DashboardAlert[];
}> {
  const [positionRows, alertRows] = await prisma.$transaction([
    positionListQuery(true),
    dashboardAlertsQuery(alertLimit),
  ]);
  return {
    positions: toPositionListItems(positionRows),
    alerts: alertRows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })),
  };
}
