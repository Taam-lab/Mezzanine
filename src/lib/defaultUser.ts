import { prisma } from "./prisma";

let cachedUserId: string | null = null;

export async function getDefaultUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const user = await prisma.user.upsert({
    where: { email: "admin@system.internal" },
    update: {},
    create: {
      email: "admin@system.internal",
      name: "관리자",
      passwordHash: "not-applicable",
      isApproved: true,
      isActive: true,
    },
    select: { id: true },
  });

  cachedUserId = user.id;
  return cachedUserId;
}
