import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchDisclosureBodyText } from "@/lib/dartScrape";
import { extractPutCall } from "@/lib/putCallExtract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/positions/[id]/reparse
 * 저장된 sourceDisclosureUrl 로 원문 스크래핑 → putCallExtract 재실행 →
 * 풋/콜 관련 필드만 업데이트. 다른 필드 (전환가액, 만기 등) 는 건드리지 않음.
 * 파서 개선 후 옛 종목의 스케줄 정리에 사용.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const position = await prisma.position.findUnique({
    where: { id: params.id },
    select: { id: true, sourceDisclosureUrl: true, assetName: true },
  });
  if (!position) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  if (!position.sourceDisclosureUrl) {
    return NextResponse.json(
      { error: "sourceDisclosureUrl 이 저장돼 있지 않아 재파싱 불가" },
      { status: 400 },
    );
  }
  const rcpMatch = position.sourceDisclosureUrl.match(/rcpNo=(\d+)/i);
  if (!rcpMatch) {
    return NextResponse.json(
      { error: "sourceDisclosureUrl 에서 rcpNo 를 찾을 수 없음" },
      { status: 400 },
    );
  }

  try {
    const bodyText = await fetchDisclosureBodyText(rcpMatch[1]);
    const extracted = extractPutCall(bodyText);
    const updated = await prisma.position.update({
      where: { id: params.id },
      data: {
        putOptionStartDate: extracted.putOptionStartDate
          ? new Date(extracted.putOptionStartDate)
          : null,
        putOptionEndDate: extracted.putOptionEndDate
          ? new Date(extracted.putOptionEndDate)
          : null,
        putOptionSchedule: extracted.putOptionSchedule ?? null,
        putOptionRate: extracted.putOptionRate ?? undefined,
        callOptionStartDate: extracted.callOptionStartDate
          ? new Date(extracted.callOptionStartDate)
          : undefined,
        callOptionEndDate: extracted.callOptionEndDate
          ? new Date(extracted.callOptionEndDate)
          : undefined,
        callOptionRatio: extracted.callOptionRatio ?? undefined,
        callOptionRate: extracted.callOptionRate ?? undefined,
      },
      select: {
        putOptionStartDate: true,
        putOptionEndDate: true,
        putOptionSchedule: true,
        putOptionRate: true,
        callOptionStartDate: true,
        callOptionEndDate: true,
        callOptionRatio: true,
        callOptionRate: true,
      },
    });
    const scheduleRows = extracted.putOptionSchedule
      ? (JSON.parse(extracted.putOptionSchedule) as unknown[]).length
      : 0;
    return NextResponse.json({
      ok: true,
      assetName: position.assetName,
      bodyLength: bodyText.length,
      scheduleRows,
      updated,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: 500 });
  }
}
