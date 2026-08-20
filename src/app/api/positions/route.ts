import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { positionSchema } from "@/lib/validations";
import { getDefaultUserId } from "@/lib/defaultUser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const active = searchParams.get("active") !== "false";

  // 목록 페이지가 실제로 렌더하는 컬럼만 select — priceSnapshots/riskCheckResults/_count는
  // 여기서 안 씀 (라이브 시세는 /api/prices에서, 위험지표는 상세 페이지에서만 조회)
  const positions = await prisma.position.findMany({
    where: { isActive: active },
    select: {
      id: true,
      bondCode: true,
      assetName: true,
      underlyingTicker: true,
      underlyingCompanyName: true,
      underlyingMarket: true,
      mezzanineType: true,
      investmentType: true,
      investmentAmount: true,
      issueDate: true,
      maturityDate: true,
      currentConversionPrice: true,
      putOptionStartDate: true,
      putOptionEndDate: true,
      putOptionSchedule: true,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(positions);
}

export async function POST(req: NextRequest) {
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
    const userId = await getDefaultUserId();

    // 중복 방지: 같은 기초자산 + 형태 + (회차 또는 채권번호) 조합이 이미 활성 상태로 있으면 거부.
    // 편집을 신규 등록으로 잘못 눌러 duplicate가 생기는 케이스 방지.
    if (data.underlyingTicker && data.mezzanineType) {
      const where: {
        isActive: true;
        underlyingTicker: string;
        mezzanineType: string;
        seriesNumber?: number;
        bondCode?: string;
      } = {
        isActive: true,
        underlyingTicker: data.underlyingTicker,
        mezzanineType: data.mezzanineType,
      };
      if (data.seriesNumber) where.seriesNumber = data.seriesNumber;
      else if (data.bondCode) where.bondCode = data.bondCode;

      const existing = await prisma.position.findFirst({
        where,
        select: { id: true, assetName: true },
      });
      if (existing) {
        return NextResponse.json(
          {
            error: `이미 등록된 종목입니다: ${existing.assetName}. 수정하시려면 종목 상세 페이지에서 편집을 사용하세요.`,
            existingPositionId: existing.id,
          },
          { status: 409 },
        );
      }
    }

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
        issueAmount: data.issueAmount ? BigInt(Math.floor(data.issueAmount)) : null,
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
        putOptionSchedule: data.putOptionSchedule || null,
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
  } catch (err) {
    console.error("[positions POST]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 }
    );
  }
}
