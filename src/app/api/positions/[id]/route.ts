import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { positionSchema } from "@/lib/validations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const position = await prisma.position.findUnique({
    where: { id: params.id },
    include: {
      priceSnapshots: { orderBy: { snapshotAt: "desc" }, take: 30 },
      financialSnapshots: { orderBy: [{ fiscalYear: "desc" }, { fiscalQuarter: "desc" }], take: 8 },
      riskCheckResults: {
        orderBy: { checkedAt: "desc" },
        distinct: ["checkId"],
      },
      disclosures: { orderBy: { filedAt: "desc" }, take: 20 },
      newsItems: { orderBy: { publishedAt: "desc" }, take: 20 },
      alerts: { orderBy: { createdAt: "desc" }, take: 10 },
      conversionPriceHistory: { orderBy: { adjustedAt: "asc" } },
      owner: { select: { name: true, email: true } },
    },
  });

  if (!position) return NextResponse.json({ error: "Not Found" }, { status: 404 });

  return NextResponse.json(position);
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
  await prisma.position.update({
    where: { id: params.id },
    data: { isActive: false },
  });

  return NextResponse.json({ ok: true });
}
