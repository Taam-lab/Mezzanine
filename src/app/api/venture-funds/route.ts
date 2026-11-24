import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 코벤펀드 명세부 저장.
 *
 * 엑셀 파싱은 브라우저에서 끝내고(src/lib/ventureFundParse.ts) 여기에는 결과 JSON 만
 * 온다. 미리보기에서 사용자가 펀드명을 고친 뒤 저장하기 때문이다.
 *
 * 펀드마다 최신 명세부 한 장만 둔다. 이미 있는 펀드면 기준일·순자산을 새 값으로 바꾸고
 * 보유종목을 통째로 갈아끼운다. 단 저장된 것보다 오래된 명세부는 받지 않는다 —
 * 지난달 파일을 실수로 다시 올려 최신 데이터를 덮는 일을 막는다.
 */

const money = z.number().int().refine(Number.isSafeInteger, "금액 범위를 벗어났습니다.");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜 형식은 YYYY-MM-DD 여야 합니다.");

const holdingSchema = z.object({
  assetClass: z.enum(["STOCK", "MEZZ", "BOND", "CASH", "DERIV", "OTHER"]),
  assetClassRaw: z.string().max(100),
  category: z.string().max(100).nullable(),
  mezzType: z.string().max(10).nullable(),
  name: z.string().min(1).max(200),
  code: z.string().max(50).nullable(),
  quantity: z.number().finite().nullable(),
  price: z.number().finite().nullable(),
  acquisitionAmount: money.nullable(),
  bookAmount: money.nullable(),
  marketValue: money,
  maturityDate: isoDate.nullable(),
});

const statementSchema = z.object({
  fundName: z.string().trim().min(1, "펀드명을 입력하세요.").max(100),
  manager: z.string().trim().max(100).nullable(),
  fundCode: z.string().trim().max(50).nullable(),
  baseDate: isoDate,
  nav: money.nullable(),
  navPerUnit: z.number().finite().nullable(),
  sourceFormat: z.enum(["TWO_LINE", "FLAT"]),
  sourceFileName: z.string().max(255).nullable(),
  holdings: z.array(holdingSchema).min(1, "보유종목이 없습니다.").max(2000),
});

const bodySchema = z.object({
  statements: z.array(statementSchema).min(1).max(50),
});

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);

export async function POST(req: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return NextResponse.json(
        { error: `${issue.path.join(".")}: ${issue.message}` },
        { status: 400 },
      );
    }
    const statements = parsed.data.statements;

    const names = statements.map((s) => s.fundName);
    if (new Set(names).size !== names.length) {
      return NextResponse.json(
        { error: "같은 펀드의 명세부가 두 번 들어 있습니다. 펀드명을 확인하세요." },
        { status: 400 },
      );
    }

    const existing = await prisma.ventureFund.findMany({
      where: { name: { in: names } },
      select: { name: true, baseDate: true },
    });
    const newer = existing.filter((f) => {
      const incoming = statements.find((s) => s.fundName === f.name)!;
      return f.baseDate > dateOnly(incoming.baseDate);
    });
    if (newer.length > 0) {
      const list = newer
        .map((f) => `${f.name}(${f.baseDate.toISOString().slice(0, 10)})`)
        .join(", ");
      return NextResponse.json(
        { error: `이미 더 최근 명세부가 있습니다: ${list}` },
        { status: 409 },
      );
    }

    // 펀드별 upsert 한 번 = 문장 하나 (중첩 쓰기는 Prisma 가 트랜잭션으로 묶는다).
    for (const s of statements) {
      const statementFields = {
        baseDate: dateOnly(s.baseDate),
        nav: s.nav === null ? null : BigInt(s.nav),
        navPerUnit: s.navPerUnit,
        sourceFormat: s.sourceFormat,
        sourceFileName: s.sourceFileName,
      };
      const holdings = s.holdings.map((h, i) => ({
        seq: i,
        assetClass: h.assetClass,
        assetClassRaw: h.assetClassRaw,
        category: h.category,
        mezzType: h.mezzType,
        name: h.name,
        code: h.code,
        quantity: h.quantity,
        price: h.price,
        acquisitionAmount: h.acquisitionAmount === null ? null : BigInt(h.acquisitionAmount),
        bookAmount: h.bookAmount === null ? null : BigInt(h.bookAmount),
        marketValue: BigInt(h.marketValue),
        maturityDate: h.maturityDate ? dateOnly(h.maturityDate) : null,
      }));

      await prisma.ventureFund.upsert({
        where: { name: s.fundName },
        create: {
          name: s.fundName,
          manager: s.manager || null,
          fundCode: s.fundCode || null,
          ...statementFields,
          holdings: { createMany: { data: holdings } },
        },
        update: {
          // 운용사·펀드코드는 새 값이 있을 때만 덮는다 (FLAT 양식은 운용사가 비어 온다).
          ...(s.manager ? { manager: s.manager } : {}),
          ...(s.fundCode ? { fundCode: s.fundCode } : {}),
          ...statementFields,
          holdings: { deleteMany: {}, createMany: { data: holdings } },
        },
        select: { id: true },
      });
    }

    return NextResponse.json(
      { saved: statements.map((s) => ({ fundName: s.fundName, baseDate: s.baseDate })) },
      { status: 201 },
    );
  } catch (err) {
    console.error("[venture-funds POST]", err);
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `서버 오류가 발생했습니다: ${detail.slice(0, 300)}` },
      { status: 500 },
    );
  }
}
