import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 부분 Exit 기록 삭제 (잘못 입력한 건 정리). 다른 종목의 기록은 지우지 않는다. */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; exitId: string } },
) {
  try {
    const { count } = await prisma.positionExit.deleteMany({
      where: { id: params.exitId, positionId: params.id },
    });
    if (count === 0) return NextResponse.json({ error: "Not Found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[positions exits DELETE]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
