import { prisma } from "./prisma";

/**
 * 공유 비밀번호 방식이라 사용자는 시스템 계정 하나뿐이다.
 *
 * 읽기 경로는 getDefaultUserId()(upsert = 쓰기 왕복) 대신 이 이메일로
 * 관계 필터(`user: { email: DEFAULT_USER_EMAIL }`)를 걸면 된다 — 계정이 아직 없으면
 * 어차피 매칭되는 상태 행도 없으므로 결과가 같고, 콜드 람다마다 붙던 upsert 가 빠진다.
 */
export const DEFAULT_USER_EMAIL = "admin@system.internal";

let cachedUserId: string | null = null;

export async function getDefaultUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;

  const user = await prisma.user.upsert({
    where: { email: DEFAULT_USER_EMAIL },
    update: {},
    create: {
      email: DEFAULT_USER_EMAIL,
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
