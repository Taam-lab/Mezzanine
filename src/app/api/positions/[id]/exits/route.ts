import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { positionExitSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 부분 Exit 기록 추가. 투자금액이 있는 종목은 Exit 누적이 투자금액을 넘지 못한다
 * (잘못 입력한 0 하나로 잔여 원금이 음수가 되는 것을 막는다).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = positionExitSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;

    const position = await prisma.position.findUnique({
      where: { id: params.id },
      select: { investmentAmount: true, exits: { select: { principalAmount: true } } },
    });
    if (!position) return NextResponse.json({ error: "Not Found" }, { status: 404 });

    if (position.investmentAmount !== null) {
      const exited = position.exits.reduce((sum, e) => sum + e.principalAmount, BigInt(0));
      const remaining = position.investmentAmount - exited;
      if (BigInt(data.principalAmount) > remaining) {
        return NextResponse.json(
          {
            error: `Exit 원금이 잔여 원금(${Number(remaining).toLocaleString("ko-KR")}원)보다 큽니다.`,
          },
          { status: 400 },
        );
      }
    }

    const exit = await prisma.positionExit.create({
      data: {
        positionId: params.id,
        exitDate: new Date(`${data.exitDate}T00:00:00Z`),
        principalAmount: BigInt(data.principalAmount),
        proceedsAmount: data.proceedsAmount === null ? null : BigInt(data.proceedsAmount),
        method: data.method || null,
        note: data.note || null,
      },
      select: { id: true },
    });
    return NextResponse.json(exit, { status: 201 });
  } catch (err) {
    console.error("[positions exits POST]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
