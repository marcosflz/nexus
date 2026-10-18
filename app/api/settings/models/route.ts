import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { credentials } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { getProvider } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 30;

const bodySchema = z.object({
  provider: z.string().min(1),
  /** Si no se envía, se usa la clave ya guardada del usuario. */
  apiKey: z.string().max(500).optional(),
});

/** Los proveedores devuelven `{data:[{id}]}`, `{models:[…]}` o una lista pelada. */
function extractModelIds(payload: unknown): string[] {
  const ids = new Set<string>();

  const push = (item: unknown) => {
    if (typeof item === "string") {
      if (item.trim()) ids.add(item.trim());
      return;
    }
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const id =
      typeof record.id === "string" && record.id
        ? record.id
        : typeof record.name === "string" && record.name
          ? record.name
          : null;
    if (id) ids.add(id);
  };

  if (Array.isArray(payload)) {
    payload.forEach(push);
  } else if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const list = Array.isArray(record.data)
      ? record.data
      : Array.isArray(record.models)
        ? record.models
        : null;
    if (list) list.forEach(push);
  }

  return [...ids].sort((a, b) => a.localeCompare(b));
}

/**
 * Lista los modelos de un proveedor para no tener que escribirlos a mano.
 *
 * La URL sale siempre de `ProviderInfo.modelsUrl`, nunca de la petición: así
 * esta ruta no puede convertirse en un SSRF que apunte a un host arbitrario con
 * la clave del usuario.
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
  if (!provider?.modelsUrl) {
    return NextResponse.json(
      { error: "Este proveedor no permite listar modelos" },
      { status: 400 },
    );
  }

  let apiKey = parsed.data.apiKey?.trim() || null;
  if (!apiKey) {
    const [row] = await db
      .select()
      .from(credentials)
      .where(eq(credentials.userId, user.id))
      .limit(1);
    // Solo vale la clave guardada si es del mismo proveedor: si el usuario
    // acaba de cambiar en el formulario, esa clave es de otro.
    if (row && row.provider === providerId && row.apiKeyEnc) {
      try {
        apiKey = decryptSecret(row.apiKeyEnc);
      } catch {
        return NextResponse.json(
          { error: "No se pudo descifrar la API key guardada" },
          { status: 500 },
        );
      }
    }
  }

  if (!apiKey) {
    return NextResponse.json(
      { error: "Introduce tu API key para listar los modelos" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(provider.modelsUrl, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
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

    const models = extractModelIds(await response.json());
    if (models.length === 0) {
      return NextResponse.json(
        { error: "El proveedor no devolvió ningún modelo" },
        { status: 400 },
      );
    }

    return NextResponse.json({ models });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return NextResponse.json(
      { error: timedOut ? "El proveedor tardó demasiado en responder" : "No se pudo contactar con el proveedor" },
      { status: 502 },
    );
  }
}
