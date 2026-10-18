import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { credentials } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { getProvider, PROVIDERS } from "@/lib/providers";

export const runtime = "nodejs";

const putSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const [row] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, user.id))
    .limit(1);

  return NextResponse.json({
    providers: PROVIDERS.map(({ id, label, needsKey, defaultModel }) => ({
      id,
      label,
      needsKey,
      defaultModel,
    })),
    credential: row
      ? {
          provider: row.provider,
          model: row.model,
          baseUrl: row.baseUrl,
          hasKey: Boolean(row.apiKeyEnc),
        }
      : null,
  });
}

export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  }
  const { provider, model, apiKey, baseUrl } = parsed.data;

  const info = getProvider(provider);
  if (!info) {
    return NextResponse.json({ error: "Proveedor no soportado" }, { status: 400 });
  }
  if (info.needsKey && !apiKey) {
    const [existing] = await db
      .select({ apiKeyEnc: credentials.apiKeyEnc })
      .from(credentials)
      .where(eq(credentials.userId, user.id))
      .limit(1);
    if (!existing?.apiKeyEnc) {
      return NextResponse.json(
        { error: "Este proveedor requiere una API key" },
        { status: 400 },
      );
    }
  }

  const apiKeyEnc =
    apiKey && apiKey.trim().length > 0 ? encryptSecret(apiKey.trim()) : undefined;

  await db
    .insert(credentials)
    .values({
      userId: user.id,
      provider,
      model,
      apiKeyEnc,
      baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: credentials.userId,
      set: {
        provider,
        model,
        ...(apiKeyEnc ? { apiKeyEnc } : {}),
        baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : null,
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  await db.delete(credentials).where(eq(credentials.userId, user.id));
  return NextResponse.json({ ok: true });
}
