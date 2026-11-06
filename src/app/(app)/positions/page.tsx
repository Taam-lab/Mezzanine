import { getPositionList } from "@/lib/positionsQuery";
import PositionsClient from "./PositionsClient";

// 매 요청 최신 목록을 서버에서 읽어 HTML 에 담아 보낸다.
// (이전에는 데이터 없는 정적 껍데기가 나가고, 브라우저가 JS 를 받아
//  하이드레이트한 뒤에야 /api/positions 를 호출해 다시 기다렸다.)
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function PositionsPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const initialPositions = await getPositionList(true);
  // ?q= 는 헤더 검색창에서 넘어온 검색어 — 목록 검색칸의 초기값이 된다.
  return (
    <PositionsClient initialPositions={initialPositions} initialSearch={searchParams.q ?? ""} />
  );
}
