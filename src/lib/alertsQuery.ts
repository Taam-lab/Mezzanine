import { prisma } from "@/lib/prisma";
import { DEFAULT_USER_EMAIL } from "@/lib/defaultUser";

/**
 * 알림함 목록 — GET /api/alerts 와 알림함 페이지(서버 컴포넌트)가 공유한다.
 *
 * 사용자 상태는 getDefaultUserId()(upsert) 없이 이메일 관계 필터로 고른다.
 * relationJoins 덕분에 position·userStatuses 까지 SQL 한 문장이다 (예전엔 upsert +
 * alerts + position + userStatuses 로 콜드 람다 기준 4쿼리).
 */
export interface AlertListItem {
  id: string;
  alertType: string;
  severity: string;
  title: string;
  body: string | null;
  sourceUrl: string | null;
  createdAt: string;
  position: { id: string; assetName: string; underlyingCompanyName: string } | null;
  userStatuses: Array<{ isRead: boolean }>;
}

export async function getAlertList(opts: {
  unreadOnly?: boolean;
  page?: number;
  limit?: number;
}): Promise<AlertListItem[]> {
  const { unreadOnly = false, page = 1, limit = 20 } = opts;
  const mine = { user: { email: DEFAULT_USER_EMAIL } };

  const rows = await prisma.alert.findMany({
    where: unreadOnly ? { userStatuses: { some: { ...mine, isRead: false } } } : {},
    select: {
      id: true,
      alertType: true,
      severity: true,
      title: true,
      body: true,
      sourceUrl: true,
      createdAt: true,
      position: { select: { id: true, assetName: true, underlyingCompanyName: true } },
      userStatuses: { where: mine, select: { isRead: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  return rows.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));
}

/** 헤더 뱃지용 미확인 개수. */
export async function countUnreadAlerts(): Promise<number> {
  return prisma.alertUserStatus.count({
    where: { user: { email: DEFAULT_USER_EMAIL }, isRead: false },
  });
}
