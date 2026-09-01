import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultUserId } from "@/lib/defaultUser";
import { sendTelegramAlert } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DISCLOSURE 알림 노이즈 정리:
 *   - metadata:null → 이전 버전 (접수일 없음) — 사용자가 시각을 오독하므로 삭제
 *   - createdAt 3일 이상 지난 DISCLOSURE — 인박스는 실시간 트리거 용도, DART 에 원문 있음
 *
 * 매 요청마다 DELETE 를 돌리면 조회 hot path 에 불필요한 write 가 끼어 응답이 느려지므로
 * 프로세스당 10분에 한 번만 실행 (그 사이엔 no-op). 정확한 즉시성이 필요한 작업이 아님.
 */
let lastCleanupAt = 0;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

async function cleanupStaleDisclosures(): Promise<void> {
  if (Date.now() - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = Date.now();
  try {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await prisma.alert.deleteMany({
      where: {
        alertType: "DISCLOSURE",
        OR: [{ metadata: null }, { createdAt: { lt: threeDaysAgo } }],
      },
    });
  } catch {
    // ignore
  }
}

/** 오늘 KST 자정을 UTC Date 로 */
function kstDayStart(): Date {
  const kstNow = new Date(Date.now() + 9 * 3600_000);
  return new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()) -
      9 * 3600_000,
  );
}

/**
 * 오늘 생성된 PRICE_MOVE 알림 중 (positionId, severity) 가 같은 것이 여러 개면
 * 가장 오래된 것만 남기고 삭제. 동시 POST 의 check-then-insert race 로 생긴
 * 중복을 사후 정리.
 */
async function dedupeSweepPriceMoves(): Promise<void> {
  try {
    const todays = await prisma.alert.findMany({
      where: { alertType: "PRICE_MOVE", createdAt: { gte: kstDayStart() } },
      select: { id: true, positionId: true, severity: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const seen = new Set<string>();
    const toDelete: string[] = [];
    for (const a of todays) {
      const key = `${a.positionId ?? "none"}:${a.severity}`;
      if (seen.has(key)) toDelete.push(a.id);
      else seen.add(key);
    }
    if (toDelete.length > 0) {
      await prisma.$transaction([
        prisma.alertUserStatus.deleteMany({ where: { alertId: { in: toDelete } } }),
        prisma.alert.deleteMany({ where: { id: { in: toDelete } } }),
      ]);
    }
  } catch {
    // ignore
  }
}

interface IncomingAlert {
  positionId?: string | null;
  alertType: string; // "PRICE_MOVE" | "DISCLOSURE" | ...
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  body?: string | null;
  sourceUrl?: string | null;
  /** ISO 문자열. 있으면 Alert.metadata 에 JSON 으로 저장해 UI 가 접수/발생 시각 표시에 사용. */
  eventAt?: string | null;
  /** dedup 윈도우 (분). */
  dedupWithinMinutes?: number;
}

export async function GET(req: NextRequest) {
  const userId = await getDefaultUserId();
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const countOnly = searchParams.get("countOnly") === "true";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");

  // GET 진입 때에도 정리 — 단, 응답을 막지 않게 fire-and-forget (10분 스로틀).
  cleanupStaleDisclosures().catch(() => {});

  if (countOnly) {
    const count = await prisma.alertUserStatus.count({
      where: { userId, isRead: false },
    });
    return NextResponse.json({ count });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = unreadOnly
    ? { userStatuses: { some: { userId, isRead: false } } }
    : {};

  const alerts = await prisma.alert.findMany({
    where,
    include: {
      position: { select: { id: true, assetName: true, underlyingCompanyName: true } },
      userStatuses: { where: { userId }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * limit,
    take: limit,
  });

  return NextResponse.json(alerts);
}

/**
 * POST /api/alerts { alerts: IncomingAlert[] }
 * 배치로 알림 인서트. Alert 모델에 unique constraint가 없어서 앱 레벨 dedup:
 *  - sourceUrl 있으면 sourceUrl 로만 판단 (재파싱 무한중복 방지)
 *  - 없으면 (positionId, alertType, title) + dedupWithinMinutes 윈도우
 */
export async function POST(req: NextRequest) {
  try {
    const { alerts } = (await req.json()) as { alerts: IncomingAlert[] };

    // 정리는 alerts 가 비어있어도 항상 실행 (classifier 가 필터해서 0개가 오는
    // 정상 경로에도 옛 알림 청소가 걸리도록).
    await cleanupStaleDisclosures();

    if (!Array.isArray(alerts) || alerts.length === 0) {
      return NextResponse.json({ created: 0 });
    }

    let created = 0;
    for (const a of alerts) {
      if (!a?.title || !a.alertType || !a.severity) continue;

      // dedup 검사
      //   - sourceUrl 있으면 sourceUrl 로만 판단 (같은 rcpNo 는 절대 중복 발송 안 함)
      //   - PRICE_MOVE 는 KST 당일 기준: 하한가에 하루 종일 붙어있어도 같은 날엔
      //     같은 (positionId, severity) 알림을 다시 만들지 않음. (60분 윈도우로는
      //     한 시간 지날 때마다 재발송돼 인박스가 도배되던 문제)
      //   - 그 외 타입은 (positionId, alertType, severity) + dedupWithinMinutes 윈도우
      if (a.sourceUrl) {
        const existing = await prisma.alert.findFirst({
          where: { sourceUrl: a.sourceUrl },
          select: { id: true },
        });
        if (existing) continue;
      } else if (a.positionId) {
        let since: Date;
        if (a.alertType === "PRICE_MOVE") {
          // KST 자정 (UTC+9): 오늘 KST 날짜의 00:00 을 UTC 로 환산
          const kstNow = new Date(Date.now() + 9 * 3600_000);
          since = new Date(
            Date.UTC(
              kstNow.getUTCFullYear(),
              kstNow.getUTCMonth(),
              kstNow.getUTCDate(),
            ) - 9 * 3600_000,
          );
        } else {
          since = new Date(Date.now() - (a.dedupWithinMinutes ?? 60) * 60_000);
        }
        const existing = await prisma.alert.findFirst({
          where: {
            positionId: a.positionId,
            alertType: a.alertType,
            severity: a.severity,
            createdAt: { gte: since },
          },
          select: { id: true },
        });
        if (existing) continue;
      }

      await prisma.alert.create({
        data: {
          positionId: a.positionId ?? null,
          alertType: a.alertType,
          severity: a.severity,
          title: a.title,
          body: a.body ?? null,
          sourceUrl: a.sourceUrl ?? null,
          metadata: a.eventAt ? JSON.stringify({ eventAt: a.eventAt }) : null,
        },
      });
      created++;

      // 텔레그램 발송 (CRITICAL/WARNING 만). 실패는 무시 — 알림 저장이 롤백되면 안 됨.
      if (a.severity === "CRITICAL" || a.severity === "WARNING") {
        sendTelegramAlert({
          title: a.title,
          body: a.body ?? null,
          severity: a.severity,
          sourceUrl: a.sourceUrl ?? null,
        }).catch(() => {});
      }
    }

    // Race 중복 정리: 동시 요청 두 개가 dedup 검사를 동시에 통과해 같은 알림을
    // 두 번 넣는 경우가 있음 (unique 제약 없음). 오늘 생성된 PRICE_MOVE 를
    // (positionId, severity) 로 그룹핑해 가장 오래된 것만 남기고 삭제.
    dedupeSweepPriceMoves().catch(() => {});

    return NextResponse.json({ created });
  } catch (err) {
    console.error("[alerts POST]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: 500 });
  }
}

/**
 * DELETE /api/alerts?id=xxx   → 단일 삭제
 * DELETE /api/alerts?all=true → 사용자 표시 알림 전체 삭제 (Alert + AlertUserStatus)
 */
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const all = searchParams.get("all") === "true";
  try {
    if (all) {
      await prisma.$transaction([
        prisma.alertUserStatus.deleteMany({}),
        prisma.alert.deleteMany({}),
      ]);
      return NextResponse.json({ ok: true, mode: "all" });
    }
    if (!id) {
      return NextResponse.json({ error: "id 또는 all=true 필요" }, { status: 400 });
    }
    await prisma.$transaction([
      prisma.alertUserStatus.deleteMany({ where: { alertId: id } }),
      prisma.alert.delete({ where: { id } }),
    ]);
    return NextResponse.json({ ok: true, mode: "single" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await getDefaultUserId();
  const body = await req.json();
  const { alertId, action } = body;

  if (action === "read_all") {
    const allAlerts = await prisma.alert.findMany({ select: { id: true } });
    const existingStatuses = await prisma.alertUserStatus.findMany({
      where: { userId },
      select: { alertId: true },
    });
    const existingIds = new Set(existingStatuses.map((s) => s.alertId));
    const newAlerts = allAlerts.filter((a) => !existingIds.has(a.id));

    await prisma.$transaction([
      prisma.alertUserStatus.updateMany({
        where: { userId },
        data: { isRead: true, readAt: new Date() },
      }),
      ...newAlerts.map((a) =>
        prisma.alertUserStatus.create({
          data: {
            alertId: a.id,
            userId,
            isRead: true,
            readAt: new Date(),
          },
        })
      ),
    ]);
    return NextResponse.json({ ok: true });
  }

  await prisma.alertUserStatus.upsert({
    where: { alertId_userId: { alertId, userId } },
    create: { alertId, userId, isRead: action === "read", readAt: new Date() },
    update: { isRead: action === "read", readAt: new Date() },
  });

  return NextResponse.json({ ok: true });
}
