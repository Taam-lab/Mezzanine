import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function checkAdminPassword(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password === (process.env.ADMIN_PASSWORD || "1019");
}

export async function GET(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.systemSetting.findMany();
  const map: Record<string, string> = {};
  settings.forEach((s) => (map[s.key] = s.value));

  const defaults = {
    price_change_threshold: "10",
    polling_interval: "5",
    allowed_domains: process.env.ALLOWED_DOMAINS || "miraeasset.com",
  };

  return NextResponse.json({ ...defaults, ...map });
}

export async function PATCH(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await req.json() as Record<string, string>;

  await prisma.$transaction(
    Object.entries(settings).map(([key, value]) =>
      prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      })
    )
  );

  return NextResponse.json({ ok: true });
}
