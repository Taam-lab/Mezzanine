import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchDisclosureBodyText } from "@/lib/dartScrape";
import { extractPutCall } from "@/lib/putCallExtract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/positions/reparse-all
 * 활성 종목 중 sourceDisclosureUrl 저장된 모든 종목의 풋/콜 필드를 일괄 재파싱.
 * 종목별로 순차 실행 (DART 서버 부하 배려).
 */
export async function POST(_req: NextRequest) {
  const positions = await prisma.position.findMany({
    where: { isActive: true, sourceDisclosureUrl: { not: null } },
    select: { id: true, assetName: true, sourceDisclosureUrl: true },
  });

  const results: Array<{
    id: string;
    assetName: string;
    ok: boolean;
    scheduleRows?: number;
    error?: string;
  }> = [];

  for (const p of positions) {
    const rcpMatch = p.sourceDisclosureUrl?.match(/rcpNo=(\d+)/i);
    if (!rcpMatch) {
      results.push({ id: p.id, assetName: p.assetName, ok: false, error: "rcpNo 없음" });
      continue;
    }
    try {
      const bodyText = await fetchDisclosureBodyText(rcpMatch[1]);
      const extracted = extractPutCall(bodyText);
      const orient = (
        from?: string,
        to?: string,
      ): [string | undefined, string | undefined] => {
        if (from && to && from > to) return [to, from];
        return [from, to];
      };
      const [putStart, putEnd] = orient(
        extracted.putOptionStartDate,
        extracted.putOptionEndDate,
      );
      const [callStart, callEnd] = orient(
        extracted.callOptionStartDate,
        extracted.callOptionEndDate,
      );
      await prisma.position.update({
        where: { id: p.id },
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
      });
      const rows = extracted.putOptionSchedule
        ? (JSON.parse(extracted.putOptionSchedule) as unknown[]).length
        : 0;
      results.push({ id: p.id, assetName: p.assetName, ok: true, scheduleRows: rows });
    } catch (e) {
      results.push({
        id: p.id,
        assetName: p.assetName,
        ok: false,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 150),
      });
    }
  }

  return NextResponse.json({
    total: positions.length,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
