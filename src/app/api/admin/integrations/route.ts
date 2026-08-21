import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt, maskSecret } from "@/lib/crypto";
import { invalidateTelegramCredsCache, sendTelegramAlert } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function checkAdminPassword(req: NextRequest): boolean {
  const password = req.headers.get("x-admin-password");
  return password === (process.env.ADMIN_PASSWORD || "1019");
}

export async function GET(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integrations = await prisma.integration.findMany();

  const masked = integrations.map((integ) => {
    let fields: Record<string, string> = {};
    if (integ.credentials) {
      try {
        const raw = decrypt(integ.credentials);
        const parsed = JSON.parse(raw) as Record<string, string>;
        fields = Object.fromEntries(
          Object.entries(parsed).map(([k, v]) => [k, maskSecret(v)])
        );
      } catch {
        fields = {};
      }
    }
    return { ...integ, credentials: null, fields };
  });

  return NextResponse.json(masked);
}

export async function POST(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serviceName, fields } = await req.json() as {
    serviceName: string;
    fields: Record<string, string>;
  };

  const encryptedCredentials = encrypt(JSON.stringify(fields));

  const integration = await prisma.integration.upsert({
    where: { serviceName },
    create: {
      serviceName,
      credentials: encryptedCredentials,
      isEnabled: true,
      lastValidatedAt: new Date(),
    },
    update: {
      credentials: encryptedCredentials,
      isEnabled: true,
      lastValidatedAt: new Date(),
    },
  });

  if (serviceName === "telegram") invalidateTelegramCredsCache();

  return NextResponse.json({ id: integration.id, serviceName: integration.serviceName, isEnabled: integration.isEnabled });
}

/**
 * PUT /api/admin/integrations { serviceName: "telegram", action: "test" }
 * 저장된 자격증명으로 실제 테스트 메시지 발송 → UI에서 잘 붙었는지 즉시 확인.
 */
export async function PUT(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { serviceName, action } = (await req.json()) as {
    serviceName: string;
    action: string;
  };
  if (serviceName === "telegram" && action === "test") {
    invalidateTelegramCredsCache();
    const result = await sendTelegramAlert({
      title: "테스트 알림",
      body: "Mezzanine Watch → 텔레그램 연동 테스트입니다. 이 메시지가 보이면 정상 연결된 것입니다.",
      severity: "WARNING",
    });
    if (result.ok) return NextResponse.json({ ok: true });
    return NextResponse.json(
      { ok: false, error: result.reason ?? "발송 실패" },
      { status: 502 },
    );
  }
  return NextResponse.json({ error: "지원하지 않는 action" }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  if (!checkAdminPassword(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { serviceName, isEnabled } = await req.json();
  const integration = await prisma.integration.update({
    where: { serviceName },
    data: { isEnabled },
  });

  return NextResponse.json(integration);
}
