import { redirect } from "next/navigation";
import { getPositionForEdit } from "@/lib/positionDetailQuery";
import EditPositionClient from "./EditPositionClient";

// 폼 기본값을 서버 렌더에 싣는다 — 종목 행 하나(쿼리 1개)만 읽는다.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function EditPositionPage({ params }: { params: { id: string } }) {
  const position = await getPositionForEdit(params.id);
  if (!position) redirect("/positions");
  return (
    <EditPositionClient id={params.id} initial={position as unknown as Record<string, unknown>} />
  );
}
