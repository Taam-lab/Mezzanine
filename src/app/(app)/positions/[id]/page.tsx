import { redirect } from "next/navigation";
import { getPositionDetail } from "@/lib/positionDetailQuery";
import PositionDetailClient from "./PositionDetailClient";

// 상세 데이터를 서버 렌더에 싣는다. 예전엔 페이지 RSC 를 받은 뒤 브라우저가
// JS 하이드레이션 → /api/positions/[id] 호출 → DB 를 다시 기다리는 2단 직렬이었다.
// 그 사이 사용자는 스피너만 봤다. 이제 loading.tsx 스켈레톤이 즉시 뜨고,
// 서버 왕복 한 번에 내용이 채워진다.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PositionDetailPage({ params }: { params: { id: string } }) {
  const position = await getPositionDetail(params.id);
  // 없는 종목(삭제 직후 router.refresh 포함)은 목록으로 — 예전 클라이언트 동작과 동일.
  if (!position) redirect("/positions");
  return <PositionDetailClient position={position} />;
}
