import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/diagnostics — 응답 속도의 바닥을 정하는 배포 환경 정보.
 *
 * 화면 하나를 그리는 데 필요한 시간은 대부분 "DB 쿼리 수 × 쿼리 1회 비용" 이다.
 * pgbouncer=true 모드의 Prisma 는 쿼리마다 BEGIN / DEALLOCATE ALL / 쿼리 / COMMIT 으로
 * 네트워크를 ~5번 왕복하므로, Vercel 함수 리전과 Supabase 리전이 다르면 (예: 기본값
 * iad1 워싱턴 ↔ 서울 DB) 쿼리 하나에 1초 가까이 걸린다. 코드로는 줄일 수 없는 부분이라
 * 관리자 화면에서 바로 확인할 수 있게 한다.
 *
 * DATABASE_URL 자체는 비밀번호가 들어 있으므로 내보내지 않는다 — 호스트에서 리전만 뽑는다.
 */

// Vercel 리전 → 같은 위치의 AWS 리전 (Supabase 는 AWS 리전 이름을 쓴다)
const VERCEL_TO_AWS: Record<string, string> = {
  icn1: "ap-northeast-2", // 서울
  hnd1: "ap-northeast-1", // 도쿄
  kix1: "ap-northeast-3", // 오사카
  sin1: "ap-southeast-1", // 싱가포르
  syd1: "ap-southeast-2",
  bom1: "ap-south-1",
  hkg1: "ap-east-1",
  iad1: "us-east-1",
  cle1: "us-east-2",
  sfo1: "us-west-1",
  pdx1: "us-west-2",
  yul1: "ca-central-1",
  gru1: "sa-east-1",
  fra1: "eu-central-1",
  dub1: "eu-west-1",
  lhr1: "eu-west-2",
  cdg1: "eu-west-3",
  arn1: "eu-north-1",
};

function checkAdminPassword(req: NextRequest): boolean {
  return req.headers.get("x-admin-password") === (process.env.ADMIN_PASSWORD || "1019");
}

export async function GET(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const functionRegion = process.env.VERCEL_REGION ?? null;

  let dbHost: string | null = null;
  let pgbouncer = false;
  let connectionLimit: string | null = null;
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    dbHost = url.hostname;
    pgbouncer = url.searchParams.get("pgbouncer") === "true";
    connectionLimit = url.searchParams.get("connection_limit");
  } catch {
    // 형식이 이상하면 리전 판정만 생략
  }
  // aws-0-ap-northeast-2.pooler.supabase.com → ap-northeast-2
  const dbRegion = dbHost?.match(/^aws-\d+-([a-z0-9-]+)\.pooler\.supabase\.com$/)?.[1] ?? null;

  // 쿼리 1회의 실제 비용. 첫 번째는 커넥션 수립이 섞이므로 버리고 나머지의 최솟값.
  const samples: number[] = [];
  for (let i = 0; i < 4; i++) {
    const t = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    samples.push(performance.now() - t);
  }
  const queryMs = Math.round(Math.min(...samples.slice(1)));

  const expectedDbRegion = functionRegion ? VERCEL_TO_AWS[functionRegion] ?? null : null;
  const sameRegion = expectedDbRegion && dbRegion ? expectedDbRegion === dbRegion : null;

  return NextResponse.json({
    functionRegion,
    dbRegion,
    sameRegion,
    pgbouncer,
    connectionLimit,
    queryMs,
  });
}
