import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mayUseClaudeCode, modelAllowed, providerAllowed } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { deleteCredential, getCredentialRow, saveProviderConfig } from "@/lib/credentials";
import { encryptSecret } from "@/lib/crypto";
import { providerViews } from "@/lib/models/available";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 30;

const modelEntry = z.object({ id: z.string().trim().min(1).max(200), label: z.string().trim().min(1).max(200) });

const putSchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().url().optional().or(z.literal("")),
  enabled: z.boolean().optional(),
  /** Modelos que el usuario quiere ver de este proveedor. */
  models: z.array(modelEntry).max(500).optional(),
  /** Modelo predeterminado del proveedor (debe estar entre los activos). */
  model: z.string().trim().max(200).optional(),
});

/** Proveedores disponibles para esta cuenta y su configuración (varios activos a la vez). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ providers: await providerViews(user) });
}

/** Guarda la configuración de UN proveedor sin cambiar cuál es el predeterminado. */
export async function PUT(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const { provider, apiKey, baseUrl, enabled, models, model } = parsed.data;

  const info = getProvider(provider);
  if (!info || !providerAllowed(user, provider)) {
    return NextResponse.json({ error: "Proveedor no disponible para tu cuenta" }, { status: 403 });
  }
  if (info.requires && !mayUseClaudeCode(user)) {
    return NextResponse.json({ error: "Un administrador debe darte permiso para usar suscripciones" }, { status: 403 });
  }
  const denied = [...(models ?? []).map((m) => m.id), ...(model ? [model] : [])].find(
    (id) => !modelAllowed(user, provider, id),
  );
  if (denied) return NextResponse.json({ error: `Tu cuenta no tiene acceso al modelo ${denied}` }, { status: 403 });
  if (model && models && !models.some((m) => m.id === model)) {
    return NextResponse.json({ error: "El modelo predeterminado debe estar entre los activos" }, { status: 400 });
  }

  const existing = await getCredentialRow(user.id, provider);
  const linked = info.linkFlow !== "key";
  if (linked && !existing) {
    return NextResponse.json({ error: `Primero vincula tu cuenta de ${info.label}` }, { status: 409 });
  }
  if (!linked && info.needsKey && !apiKey?.trim() && !existing?.apiKeyEnc) {
    return NextResponse.json({ error: "Este proveedor requiere una API key" }, { status: 400 });
  }

  await saveProviderConfig({
    userId: user.id,
    provider,
    // Las suscripciones vinculadas nunca reciben una clave por aquí.
    apiKeyEnc: !linked && apiKey?.trim() ? encryptSecret(apiKey.trim()) : undefined,
    baseUrl: linked ? undefined : baseUrl === undefined ? undefined : baseUrl || null,
    enabled,
    models,
    model: model ?? (existing ? undefined : (models?.[0]?.id ?? info.defaultModel)),
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
