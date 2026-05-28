import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getDefaultUserId } from "@/lib/defaultUser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
