import { and, desc, eq, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import { credentials } from "@/lib/db/schema";

export type CredentialRow = typeof credentials.$inferSelect;

/** Todas las credenciales del usuario, la predeterminada primero. */
export async function listCredentials(userId: string): Promise<CredentialRow[]> {
  return db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, userId))
    .orderBy(desc(credentials.isDefault), desc(credentials.updatedAt));
}

/**
 * Credencial para un proveedor concreto o, sin proveedor, la predeterminada.
 * Si se pide un proveedor que el usuario no ha configurado devuelve null: no se
 * sustituye en silencio por otro, porque mandaría su clave a un tercero.
 */
export async function getCredentialRow(
  userId: string,
  provider?: string | null,
): Promise<CredentialRow | null> {
  if (provider) {
    const [row] = await db
      .select()
      .from(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.provider, provider)))
      .limit(1);
    return row ?? null;
  }
  return (await listCredentials(userId))[0] ?? null;
}

export interface SaveCredential {
  userId: string;
  provider: string;
  model: string;
  apiKeyEnc?: string;
  baseUrl: string | null;
}

/** Guarda (o actualiza) la credencial de un proveedor y la marca como predeterminada. */
export async function saveCredential(input: SaveCredential): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(credentials)
      .values({
        userId: input.userId,
        provider: input.provider,
        model: input.model,
        apiKeyEnc: input.apiKeyEnc,
        baseUrl: input.baseUrl,
        isDefault: true,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [credentials.userId, credentials.provider],
        set: {
          model: input.model,
          ...(input.apiKeyEnc ? { apiKeyEnc: input.apiKeyEnc } : {}),
          baseUrl: input.baseUrl,
          isDefault: true,
          updatedAt: new Date(),
        },
      });
    await tx
      .update(credentials)
      .set({ isDefault: false })
      .where(and(eq(credentials.userId, input.userId), ne(credentials.provider, input.provider)));
  });
}

/** Borra la credencial de un proveedor y, si era la predeterminada, promueve otra. */
export async function deleteCredential(userId: string, provider: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(credentials)
      .where(and(eq(credentials.userId, userId), eq(credentials.provider, provider)))
      .returning({ isDefault: credentials.isDefault });
    if (!removed?.isDefault) return;
    const [next] = await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(eq(credentials.userId, userId))
      .orderBy(desc(credentials.updatedAt))
      .limit(1);
    if (next) await tx.update(credentials).set({ isDefault: true }).where(eq(credentials.id, next.id));
  });
}

/**
 * Guarda solo la clave cifrada de un proveedor, sin tocar cuál es el predeterminado.
 * Si el usuario aún no tenía ninguna credencial, esta pasa a serlo.
 */
export async function setCredentialKey(input: {
  userId: string;
  provider: string;
  apiKeyEnc: string;
  defaultModel: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [any] = await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(eq(credentials.userId, input.userId))
      .limit(1);
    await tx
      .insert(credentials)
      .values({
        userId: input.userId,
        provider: input.provider,
        model: input.defaultModel,
        apiKeyEnc: input.apiKeyEnc,
        baseUrl: null,
        isDefault: !any,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [credentials.userId, credentials.provider],
        set: { apiKeyEnc: input.apiKeyEnc, updatedAt: new Date() },
      });
  });
}

/** Borra la clave de un proveedor y conserva el resto (modelo elegido, predeterminado). */
export async function clearCredentialKey(userId: string, provider: string): Promise<void> {
  await db
    .update(credentials)
    .set({ apiKeyEnc: null, updatedAt: new Date() })
    .where(and(eq(credentials.userId, userId), eq(credentials.provider, provider)));
}

export interface ModelEntry {
  id: string;
  label: string;
  /** Aviso para el catálogo (no se guarda). */
  hint?: string;
}

/** Modelos activos de una credencial (las filas antiguas guardaban solo ids). */
export function enabledModels(row: Pick<CredentialRow, "models" | "model">): ModelEntry[] {
  const raw = Array.isArray(row.models) ? row.models : row.model ? [row.model] : [];
  const seen = new Set<string>();
  const out: ModelEntry[] = [];
  for (const item of raw) {
    const entry = typeof item === "string" ? { id: item, label: item } : item;
    if (!entry || typeof entry.id !== "string" || !entry.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push({ id: entry.id, label: typeof entry.label === "string" && entry.label ? entry.label : entry.id });
  }
  return out;
}

export interface ProviderConfigInput {
  userId: string;
  provider: string;
  /** Clave nueva cifrada; sin ella se conserva la guardada. */
  apiKeyEnc?: string;
  baseUrl?: string | null;
  enabled?: boolean;
  models?: ModelEntry[];
  /** Modelo predeterminado del proveedor. */
  model?: string;
}

/**
 * Crea o actualiza la configuración de un proveedor SIN cambiar cuál es el predeterminado
 * del usuario (salvo que sea su primera credencial).
 */
export async function saveProviderConfig(input: ProviderConfigInput): Promise<void> {
  await db.transaction(async (tx) => {
    const [any] = await tx
      .select({ id: credentials.id })
      .from(credentials)
      .where(eq(credentials.userId, input.userId))
      .limit(1);
    const models = input.models;
    const model = input.model ?? models?.[0]?.id ?? "";
    await tx
      .insert(credentials)
      .values({
        userId: input.userId,
        provider: input.provider,
        model,
        apiKeyEnc: input.apiKeyEnc,
        baseUrl: input.baseUrl ?? null,
        enabled: input.enabled ?? true,
        models: models ?? (model ? [{ id: model, label: model }] : []),
        isDefault: !any,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [credentials.userId, credentials.provider],
        set: {
          ...(input.apiKeyEnc ? { apiKeyEnc: input.apiKeyEnc } : {}),
          ...(input.baseUrl !== undefined ? { baseUrl: input.baseUrl } : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          ...(models !== undefined ? { models } : {}),
          ...(input.model !== undefined ? { model: input.model } : {}),
          updatedAt: new Date(),
        },
      });
  });
}

/** Marca un proveedor (y opcionalmente su modelo) como el predeterminado del usuario. */
export async function setDefaultCredential(userId: string, provider: string, model?: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(credentials)
      .set({ isDefault: true, ...(model ? { model } : {}), updatedAt: new Date() })
      .where(and(eq(credentials.userId, userId), eq(credentials.provider, provider)))
      .returning({ id: credentials.id });
    if (updated.length === 0) return false;
    await tx
      .update(credentials)
      .set({ isDefault: false })
      .where(and(eq(credentials.userId, userId), ne(credentials.provider, provider)));
    return true;
  });
}
