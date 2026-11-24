import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 명세부 한 장 삭제 (잘못 올린 파일 정리용). 보유종목은 FK cascade 로 같이 지워진다.
 * 그 펀드에 남은 명세부가 없으면 펀드도 지운다 — 펀드명을 잘못 적어 생긴 펀드가
 * 목록에 남지 않게.
 */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const statement = await prisma.ventureFundStatement.findUnique({
      where: { id: params.id },
      select: { fundId: true },
    });
    if (!statement) return NextResponse.json({ error: "Not Found" }, { status: 404 });

    await prisma.ventureFundStatement.delete({ where: { id: params.id } });
    await prisma.ventureFund.deleteMany({
      where: { id: statement.fundId, statements: { none: {} } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[venture-funds statements DELETE]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
