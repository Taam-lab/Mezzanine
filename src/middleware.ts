import { NextRequest, NextResponse } from "next/server";

/**
 * 기대 토큰은 (password, secret) 에서만 결정되므로 요청마다 다시 해싱할 이유가 없다.
 * 매 요청 SHA-256 다이제스트를 계산하던 것을 첫 요청 때 한 번만 계산하고 재사용.
 * (Edge 런타임은 모듈 스코프가 인스턴스 수명 동안 유지된다.)
 */
let expectedTokenPromise: Promise<string> | null = null;

function getExpectedToken(): Promise<string> {
  if (!expectedTokenPromise) {
    const password = process.env.ACCESS_PASSWORD || "multi1234";
    const secret = process.env.NEXTAUTH_SECRET || "mezzanine-secret";
    expectedTokenPromise = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(`${password}:${secret}`))
      .then((buf) =>
        Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );
  }
  return expectedTokenPromise;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  const token = req.cookies.get("auth-token")?.value;
  if (!token || token !== (await getExpectedToken())) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.png|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
