import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { positionSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = params.id;

  // 8개 관계를 하나의 include로 묶으면 Prisma가 순차 서브쿼리로 처리하는 경우가 있어서
  // 상세 페이지가 눈에 띄게 느렸다. 관계별로 independent query를 병렬로 실행.
  const [
    position,
    priceSnapshots,
    financialSnapshots,
    riskCheckResults,
    disclosures,
    newsItems,
    alerts,
    conversionPriceHistory,
  ] = await Promise.all([
    prisma.position.findUnique({
      where: { id },
      include: { owner: { select: { name: true, email: true } } },
    }),
    prisma.priceSnapshot.findMany({
      where: { positionId: id },
      orderBy: { snapshotAt: "desc" },
      take: 30,
    }),
    prisma.financialSnapshot.findMany({
      where: { positionId: id },
      orderBy: [{ fiscalYear: "desc" }, { fiscalQuarter: "desc" }],
      take: 8,
    }),
    prisma.riskCheckResult.findMany({
      where: { positionId: id },
      orderBy: { checkedAt: "desc" },
      distinct: ["checkId"],
    }),
    prisma.disclosure.findMany({
      where: { positionId: id },
      orderBy: { filedAt: "desc" },
      take: 20,
    }),
    prisma.newsItem.findMany({
      where: { positionId: id },
      orderBy: { publishedAt: "desc" },
      take: 20,
    }),
    prisma.alert.findMany({
      where: { positionId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    prisma.conversionPriceHistory.findMany({
      where: { positionId: id },
      orderBy: { adjustedAt: "asc" },
    }),
  ]);

  if (!position) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  return NextResponse.json({
    ...position,
    priceSnapshots,
    financialSnapshots,
    riskCheckResults,
    disclosures,
    newsItems,
    alerts,
    conversionPriceHistory,
  });
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const parsed = positionSchema.partial().safeParse(body);

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
