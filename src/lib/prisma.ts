import { PrismaClient } from "@prisma/client";

// BigInt → JSON 직렬화: Prisma가 BigInt를 반환하면 NextResponse.json이 깨지므로
// 글로벌로 toJSON을 정의 (문자열로 직렬화)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined };

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// Proxy로 감싸서 모듈 로드 시점이 아닌 첫 접근 시에 PrismaClient를 초기화
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    const client = globalForPrisma.prisma;
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as Function).bind(client) : value;
  },
});
