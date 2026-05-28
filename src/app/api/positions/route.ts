import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { positionSchema } from "@/lib/validations";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const active = searchParams.get("active") !== "false";

  const positions = await prisma.position.findMany({
    where: { isActive: active },
    include: {
      priceSnapshots: {
        orderBy: { snapshotAt: "desc" },
        take: 1,
      },
      riskCheckResults: {
        orderBy: { checkedAt: "desc" },
        distinct: ["checkId"],
      },
      _count: { select: { alerts: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(positions);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as { id: string }).id;

  try {
    const body = await req.json();
    const parsed = positionSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const data = parsed.data;

    const position = await prisma.position.create({
      data: {
        bondCode: data.bondCode || null,
        assetName: data.assetName,
        underlyingTicker: data.underlyingTicker,
        underlyingCompanyName: data.underlyingCompanyName,
        underlyingMarket: data.underlyingMarket,
        mezzanineType: data.mezzanineType,
        issueDate: data.issueDate ? new Date(data.issueDate) : null,
        investmentType: data.investmentType,
        investmentAmount: data.investmentAmount ? BigInt(Math.floor(data.investmentAmount)) : null,
        maturityDate: data.maturityDate ? new Date(data.maturityDate) : null,
        couponRate: data.couponRate ?? null,
        ytm: data.ytm ?? null,
        initialConversionPrice: data.initialConversionPrice ?? null,
        minConversionPrice: data.minConversionPrice ?? null,
        currentConversionPrice: data.currentConversionPrice ?? data.initialConversionPrice ?? null,
        conversionStartDate: data.conversionStartDate ? new Date(data.conversionStartDate) : null,
        conversionEndDate: data.conversionEndDate ? new Date(data.conversionEndDate) : null,
        putOptionRate: data.putOptionRate ?? null,
        putOptionStartDate: data.putOptionStartDate ? new Date(data.putOptionStartDate) : null,
        putOptionEndDate: data.putOptionEndDate ? new Date(data.putOptionEndDate) : null,
        callOptionRatio: data.callOptionRatio ?? null,
        callOptionStartDate: data.callOptionStartDate ? new Date(data.callOptionStartDate) : null,
        callOptionEndDate: data.callOptionEndDate ? new Date(data.callOptionEndDate) : null,
        callOptionRate: data.callOptionRate ?? null,
        seriesNumber: data.seriesNumber ?? null,
        sourceDisclosureUrl: data.sourceDisclosureUrl || null,
        note: data.note || null,
        ownerUserId: userId,
      },
    });

    return NextResponse.json(position, { status: 201 });
  } catch {
    return NextResponse.json({ error: "서버 오류가 발생했습니다." }, { status: 500 });
  }
}
