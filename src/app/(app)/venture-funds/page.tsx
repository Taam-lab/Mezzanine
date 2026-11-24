import { getVentureFunds } from "@/lib/ventureFundsQuery";
import VentureFundsClient from "./VentureFundsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function VentureFundsPage() {
  const funds = await getVentureFunds();
  return <VentureFundsClient funds={funds} />;
}
