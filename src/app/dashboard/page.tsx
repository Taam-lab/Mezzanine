import { getPositionList } from "@/lib/positionsQuery";
import { getDashboardAlerts } from "@/lib/dashboardQuery";
import DashboardClient from "./DashboardClient";

// DB 데이터(보유종목·알림)는 서버 렌더에 싣고, 느린 외부 API(네이버 시세,
// 구글뉴스/DART 피드)는 클라이언트가 이어서 채운다.
// 이전에는 데이터 없는 정적 HTML 이 나가고, 브라우저가 JS 를 받아 하이드레이트한
// 뒤에야 /api/dashboard/init 을 호출해 다시 기다렸다.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function DashboardPage() {
  const [positions, alerts] = await Promise.all([
    getPositionList(true),
    getDashboardAlerts(20),
  ]);

  return <DashboardClient initialPositions={positions} initialAlerts={alerts} />;
}
