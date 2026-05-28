import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function checkAdminPassword(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password === (process.env.ADMIN_PASSWORD || "1019");
}

export async function GET(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      isApproved: true,
      isActive: true,
      approvedAt: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json(users);
}

export async function PATCH(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId, action } = await req.json();

  const updateData: Record<string, unknown> = {};

  if (action === "approve") {
    updateData.isApproved = true;
    updateData.approvedAt = new Date();
  } else if (action === "reject") {
    updateData.isApproved = false;
    updateData.isActive = false;
  } else if (action === "activate") {
    updateData.isActive = true;
  } else if (action === "deactivate") {
    updateData.isActive = false;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { id: true, email: true, name: true, isApproved: true, isActive: true },
  });

  return NextResponse.json(user);
}
