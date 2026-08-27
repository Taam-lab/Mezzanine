import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultUserId } from "@/lib/defaultUser";
import { sendTelegramAlert } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface IncomingAlert {
  positionId?: string | null;
  alertType: string; // "PRICE_MOVE" | "DISCLOSURE" | ...
  severity: "CRITICAL" | "WARNING" | "INFO";
  title: string;
  body?: string | null;
  sourceUrl?: string | null;
  /** dedup 윈도우 (분). 같은 (positionId, alertType, title) 이 이 시간 안에 있으면 스킵. */
  dedupWithinMinutes?: number;
}

export async function GET(req: NextRequest) {
  const userId = await getDefaultUserId();
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const countOnly = searchParams.get("countOnly") === "true";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");

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
    if (!Array.isArray(alerts) || alerts.length === 0) {
      return NextResponse.json({ created: 0 });
    }

    let created = 0;
    for (const a of alerts) {
      if (!a?.title || !a.alertType || !a.severity) continue;

      // dedup 검사
      //   - sourceUrl 있으면 sourceUrl 로만 판단 (같은 rcpNo 는 절대 중복 발송 안 함)
      //   - 없으면 (positionId, alertType, severity) + 시간창
      //     (title 매칭은 안 씀 — 예: PRICE_MOVE 는 등락률 소수점 때문에 매번 title 이
      //      달라져 dedup 이 안 걸리던 문제 해결)
      if (a.sourceUrl) {
        const existing = await prisma.alert.findFirst({
          where: { sourceUrl: a.sourceUrl },
          select: { id: true },
        });
        if (existing) continue;
      } else if (a.positionId) {
        const windowMs = (a.dedupWithinMinutes ?? 60) * 60_000;
        const existing = await prisma.alert.findFirst({
          where: {
            positionId: a.positionId,
            alertType: a.alertType,
            severity: a.severity,
            createdAt: { gte: new Date(Date.now() - windowMs) },
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

    return NextResponse.json({ created });
  } catch (err) {
    console.error("[alerts POST]", err);
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
