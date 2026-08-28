/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next 14 는 experimental.serverComponentsExternalPackages 가 맞는 키.
  // (기존 serverExternalPackages 는 Next 15 명칭이라 무시되고 있었음 — 빌드 경고의 원인.
  //  Prisma 가 번들에 포함돼 lambda 크기·콜드스타트만 키우고 있었다.)
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
    // lucide-react 아이콘을 named import 단위로 트리셰이킹 → 클라이언트 JS 축소
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
