import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NULLABLE_POSITION_FIELDS, positionSchema } from "@/lib/validations";
import { getPositionDetail } from "@/lib/positionDetailQuery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  // 상세 페이지 서버 컴포넌트와 같은 조회를 공유한다 (src/lib/positionDetailQuery.ts).
  // 관계 5개를 SQL 한 문장으로 읽는다 — 이전 구현은 7쿼리(25문장)였다.
  const position = await getPositionDetail(params.id);
  if (!position) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  return NextResponse.json(position);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = (await req.json()) as Record<string, unknown>;

    // null = "이 칸을 비워라" (수정 폼이 지운 칸). 스키마는 null 을 받지 않으므로
    // 비울 수 있는 컬럼의 null 만 따로 빼 두고 나머지만 검증한다.
    const nullable = new Set<string>(NULLABLE_POSITION_FIELDS);
    const cleared: Record<string, null> = {};
    const rest: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value === null && nullable.has(key)) cleared[key] = null;
      else rest[key] = value;
    }
    const parsed = positionSchema.partial().safeParse(rest);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const data = parsed.data;
    const updated = await prisma.position.update({
      where: { id: params.id },
      data: {
        ...data,
        issueDate: data.issueDate ? new Date(data.issueDate) : undefined,
        maturityDate: data.maturityDate ? new Date(data.maturityDate) : undefined,
        conversionStartDate: data.conversionStartDate ? new Date(data.conversionStartDate) : undefined,
        conversionEndDate: data.conversionEndDate ? new Date(data.conversionEndDate) : undefined,
        putOptionStartDate: data.putOptionStartDate ? new Date(data.putOptionStartDate) : undefined,
        putOptionEndDate: data.putOptionEndDate ? new Date(data.putOptionEndDate) : undefined,
        callOptionStartDate: data.callOptionStartDate ? new Date(data.callOptionStartDate) : undefined,
        callOptionEndDate: data.callOptionEndDate ? new Date(data.callOptionEndDate) : undefined,
        investmentAmount: data.investmentAmount
          ? BigInt(Math.floor(data.investmentAmount))
          : undefined,
        issueAmount: data.issueAmount
          ? BigInt(Math.floor(data.issueAmount))
          : undefined,
        ...cleared,
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[positions PATCH]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const positionId = params.id;

  // 스키마에 onDelete: Cascade가 없어서 FK 순서대로 트랜잭션으로 지운다.
  //
  // 의존성:
  //   AlertUserStatus → Alert → Position
  //   ConversionPriceHistory → Position + Disclosure
  //   Disclosure → Position
  //   NewsItem / PriceSnapshot / FinancialSnapshot / RiskCheckResult → Position
  try {
    await prisma.$transaction([
      prisma.alertUserStatus.deleteMany({ where: { alert: { positionId } } }),
      prisma.alert.deleteMany({ where: { positionId } }),
      prisma.conversionPriceHistory.deleteMany({ where: { positionId } }),
      prisma.disclosure.deleteMany({ where: { positionId } }),
      prisma.newsItem.deleteMany({ where: { positionId } }),
      prisma.priceSnapshot.deleteMany({ where: { positionId } }),
      prisma.financialSnapshot.deleteMany({ where: { positionId } }),
      prisma.riskCheckResult.deleteMany({ where: { positionId } }),
      prisma.position.delete({ where: { id: positionId } }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[positions DELETE]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `삭제 실패: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
