import { getVentureFundsPageData } from "@/lib/ventureFundsQuery";
import VentureFundsClient from "./VentureFundsClient";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function VentureFundsPage({
  searchParams,
}: {
  searchParams: { date?: string; fund?: string };
}) {
  const data = await getVentureFundsPageData(searchParams.date);
  return <VentureFundsClient data={data} initialFundId={searchParams.fund ?? null} />;
}
