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
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { searchParams } = new URL(req.url);
  const debug = searchParams.get("debug") === "true";
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

    // 방어: 시작 > 종료로 뒤집혀 있으면 swap (파싱 로직 회귀 시 최후 안전장치)
    const orient = (from?: string, to?: string): [string | undefined, string | undefined] => {
      if (from && to && from > to) return [to, from];
      return [from, to];
    };
    const [putStart, putEnd] = orient(extracted.putOptionStartDate, extracted.putOptionEndDate);
    const [callStart, callEnd] = orient(
      extracted.callOptionStartDate,
      extracted.callOptionEndDate,
    );

    // 명시적 null 로 덮어쓰기: 파서가 콜 필드 추출 실패 (undefined) 시 옛 값이
    // 남아 있으면 사용자가 재파싱 결과에 반영 안 됐다고 오해. null 로 clear.
    const updated = await prisma.position.update({
      where: { id: params.id },
      data: {
        putOptionStartDate: putStart ? new Date(putStart) : null,
        putOptionEndDate: putEnd ? new Date(putEnd) : null,
        putOptionSchedule: extracted.putOptionSchedule ?? null,
        putOptionRate: extracted.putOptionRate ?? null,
        callOptionStartDate: callStart ? new Date(callStart) : null,
        callOptionEndDate: callEnd ? new Date(callEnd) : null,
        callOptionRatio: extracted.callOptionRatio ?? null,
        callOptionRate: extracted.callOptionRate ?? null,
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
    // debug 모드: 파서가 실제로 스캔한 콜/풋 섹션 원문 텍스트를 반환.
    // 원문을 못 보는 환경에서 정규식 튜닝 도구로 활용.
    let debugData: Record<string, string> | undefined;
    if (debug) {
      const callIdx = bodyText.search(/매도청구권|Call\s*Option/i);
      const putIdx = bodyText.search(/조기상환청구권|조기상환\s*청구\s*기간|Put\s*Option/i);
      debugData = {
        bodyPreview: bodyText.slice(0, 500),
        callSection: callIdx !== -1 ? bodyText.slice(callIdx, callIdx + 3500) : "(not found)",
        putSection: putIdx !== -1 ? bodyText.slice(putIdx, putIdx + 3500) : "(not found)",
      };
    }
    return NextResponse.json({
      ok: true,
      assetName: position.assetName,
      bodyLength: bodyText.length,
      scheduleRows,
      extracted, // 파서 원본 출력 — alert 에서 디버그 확인용
      updated,
      debug: debugData,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: detail.slice(0, 300) }, { status: 500 });
  }
}
