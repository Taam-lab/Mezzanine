import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 펀드명·운용사 수정. 명세부에 펀드명이 없는 양식은 파일명에서 추정하므로 고칠 일이 생긴다. */
const patchSchema = z.object({
  name: z.string().trim().min(1, "펀드명을 입력하세요.").max(100).optional(),
  manager: z.string().trim().max(100).nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const { name, manager } = parsed.data;
    const fund = await prisma.ventureFund.update({
      where: { id: params.id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(manager !== undefined ? { manager: manager || null } : {}),
      },
      select: { id: true, name: true, manager: true },
    });
    return NextResponse.json(fund);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === "P2002") {
        return NextResponse.json({ error: "같은 이름의 펀드가 이미 있습니다." }, { status: 409 });
      }
      if (err.code === "P2025") {
        return NextResponse.json({ error: "Not Found" }, { status: 404 });
      }
    }
    console.error("[venture-funds PATCH]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
