export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/positions/:path*",
    "/alerts/:path*",
    "/settings/:path*",
  ],
};
