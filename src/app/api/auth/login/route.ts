import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function makeToken(): string {
  const password = process.env.ACCESS_PASSWORD || "multi1234";
  const secret = process.env.NEXTAUTH_SECRET || "mezzanine-secret";
  return createHash("sha256").update(`${password}:${secret}`).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const accessPassword = process.env.ACCESS_PASSWORD || "multi1234";

    if (password !== accessPassword) {
      return NextResponse.json({ error: "비밀번호가 올바르지 않습니다." }, { status: 401 });
    }

    const token = makeToken();
    const res = NextResponse.json({ ok: true });
    res.cookies.set("auth-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
      path: "/",
    });
    return res;
  } catch {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
