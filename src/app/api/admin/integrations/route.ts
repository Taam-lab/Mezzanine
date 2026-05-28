import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt, maskSecret } from "@/lib/crypto";

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

  return NextResponse.json({ id: integration.id, serviceName: integration.serviceName, isEnabled: integration.isEnabled });
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
