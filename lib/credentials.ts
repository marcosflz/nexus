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
