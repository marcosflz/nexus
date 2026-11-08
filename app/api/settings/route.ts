import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { deleteCredential, getCredentialRow, listCredentials, saveCredential } from "@/lib/credentials";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { sidecarCapabilities } from "@/lib/agents/backends/nas-adk";
import { CLAUDE_CODE_PROVIDER, getProvider, PROVIDERS } from "@/lib/providers";

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

  const mayUseClaudeCode = user.role === "admin" || user.canUseClaudeCode;
  // Quien no tiene permiso no ve el proveedor, ni aunque le quedara guardado de antes.
  const rows = (await listCredentials(user.id)).filter(
    (item) => mayUseClaudeCode || item.provider !== CLAUDE_CODE_PROVIDER,
  );
  const row = rows[0];
  const claudeCode = mayUseClaudeCode ? (await sidecarCapabilities()).claudeCode : null;

  return NextResponse.json({
    providers: PROVIDERS.filter((item) => item.requires !== "claudeCode" || mayUseClaudeCode).map(
      ({ id, label, needsKey, defaultModel, modelsUrl, modelOptions, requires }) => ({
        id,
        label,
        needsKey,
        defaultModel,
        canListModels: Boolean(modelsUrl),
        modelOptions: modelOptions ?? null,
        serverManaged: requires === "claudeCode",
        // Motivo por el que no se puede usar ahora mismo; null si está listo.
        unavailable:
          requires === "claudeCode" && claudeCode && !claudeCode.available
            ? (claudeCode.reason ?? "No disponible")
            : null,
      }),
    ),
    credential: row
      ? {
          provider: row.provider,
          model: row.model,
          baseUrl: row.baseUrl,
          hasKey: Boolean(row.apiKeyEnc),
        }
      : null,
    // Una entrada por proveedor ya configurado, para recordar clave y modelo al cambiar.
    saved: rows.map((item) => ({
      provider: item.provider,
      model: item.model,
      baseUrl: item.baseUrl,
      hasKey: Boolean(item.apiKeyEnc),
      isDefault: item.isDefault,
    })),
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
  if (info.requires === "claudeCode") {
    if (user.role !== "admin" && !user.canUseClaudeCode) {
      return NextResponse.json({ error: "Un administrador debe darte permiso para usar Claude Code" }, { status: 403 });
    }
    const { claudeCode } = await sidecarCapabilities();
    if (!claudeCode.available) {
      return NextResponse.json({ error: claudeCode.reason ?? "Claude Code no está disponible" }, { status: 409 });
    }
    await saveCredential({ userId: user.id, provider, model, apiKeyEnc: undefined, baseUrl: null });
    return NextResponse.json({ ok: true });
  }

  if (info.needsKey && !apiKey) {
    const existing = await getCredentialRow(user.id, provider);
    if (!existing?.apiKeyEnc) {
      return NextResponse.json(
        { error: "Este proveedor requiere una API key" },
        { status: 400 },
      );
    }
  }

  await saveCredential({
    userId: user.id,
    provider,
    model,
    apiKeyEnc: apiKey && apiKey.trim().length > 0 ? encryptSecret(apiKey.trim()) : undefined,
    baseUrl: baseUrl && baseUrl.length > 0 ? baseUrl : null,
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const provider = req.nextUrl.searchParams.get("provider");
  if (!provider) return NextResponse.json({ error: "Indica el proveedor" }, { status: 400 });
  await deleteCredential(user.id, provider);
  return NextResponse.json({ ok: true });
}
