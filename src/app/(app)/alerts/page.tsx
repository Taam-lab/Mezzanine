import { getAlertList } from "@/lib/alertsQuery";
import AlertsClient from "./AlertsClient";

// 알림 목록을 서버 렌더에 싣는다 (예전엔 하이드레이션 후 /api/alerts 를 따로 호출).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AlertsPage() {
  const alerts = await getAlertList({ limit: 50 });
  return <AlertsClient initialAlerts={alerts} />;
}
