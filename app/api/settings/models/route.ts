import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { mayUseClaudeCode, modelAllowed, providerAllowed } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { getCredentialRow, type ModelEntry } from "@/lib/credentials";
import { decryptSecret } from "@/lib/crypto";
import { listChatGptModels } from "@/lib/instance/chatgpt";
import { listClaudeCodeModels } from "@/lib/instance/claude-code";
import { extractModelEntries } from "@/lib/models/catalog";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 80;

const bodySchema = z.object({
  provider: z.string().min(1),
  /** Si no se envía, se usa la clave ya guardada del usuario. */
  apiKey: z.string().max(500).optional(),
});

function reply(user: Parameters<typeof modelAllowed>[0], providerId: string, all: ModelEntry[]) {
  const catalog = all.filter((model) => modelAllowed(user, providerId, model.id));
  if (catalog.length === 0) {
    return NextResponse.json({ error: "El proveedor no devolvió ningún modelo" }, { status: 400 });
  }
  return NextResponse.json({ catalog, models: catalog.map((model) => model.id) });
}

/**
 * Catálogo de modelos de un proveedor para elegir cuáles mostrar.
 *
 * - Suscripciones vinculadas (Claude, ChatGPT): los modelos de la cuenta del usuario.
 * - Servicios con clave: la URL sale siempre de `ProviderInfo.modelsUrl`, nunca de la
 *   petición, para que esta ruta no sea un SSRF con la clave del usuario.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }
  const { provider: providerId } = parsed.data;
  const provider = getProvider(providerId);
  if (!provider || !providerAllowed(user, providerId) || (provider.requires && !mayUseClaudeCode(user))) {
    return NextResponse.json({ error: "Proveedor no disponible" }, { status: 403 });
  }

  if (provider.linkFlow === "claude" || provider.linkFlow === "chatgpt") {
    const result = provider.linkFlow === "claude" ? await listClaudeCodeModels(user.id) : await listChatGptModels(user.id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return reply(user, providerId, result.models);
  }

  if (!provider.modelsUrl) {
    return NextResponse.json({ error: "Este proveedor no permite listar modelos: escribe su nombre" }, { status: 400 });
  }

  let apiKey = parsed.data.apiKey?.trim() || null;
  if (!apiKey) {
    const row = await getCredentialRow(user.id, providerId);
    if (row?.apiKeyEnc) {
      try {
        apiKey = decryptSecret(row.apiKeyEnc);
      } catch {
        return NextResponse.json({ error: "No se pudo descifrar la API key guardada" }, { status: 500 });
      }
    }
  }
  if (!apiKey) {
    return NextResponse.json({ error: "Introduce tu API key para listar los modelos" }, { status: 400 });
  }

  try {
    const auth: Record<string, string> =
      provider.modelsAuth === "anthropic"
        ? { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }
        : { Authorization: `Bearer ${apiKey}` };
    const response = await fetch(provider.modelsUrl, {
      headers: { ...auth, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      return NextResponse.json(
        {
          error:
            response.status === 401 || response.status === 403
              ? "La API key no es válida o ha caducado"
              : `El proveedor respondió ${response.status}`,
        },
        { status: 400 },
      );
    }
    return reply(user, providerId, extractModelEntries(await response.json()));
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      { error: timedOut ? "El proveedor tardó demasiado en responder" : "No se pudo contactar con el proveedor" },
      { status: 502 },
    );
  }
}
