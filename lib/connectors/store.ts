import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { connectors } from "@/lib/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { isUniqueViolation } from "@/lib/db/errors";
import type { ConnectorLink } from "@/lib/agents/backend";
import type { AgentSpec } from "@/lib/agents/spec";
import { hasPermission } from "@/lib/access";
import { ensureBrowser } from "@/lib/sandbox/client";
import { getUserAccess } from "@/lib/users";
import { authHeaders, checkConnectorUrl } from "./validate";

export const allowPrivateConnectors = () => /^(1|true|on|yes)$/i.test(process.env.NEXUS_ALLOW_PRIVATE_CONNECTORS ?? "");

export async function listConnectors(userId: string) {
  const rows = await db.select().from(connectors).where(eq(connectors.userId, userId)).orderBy(connectors.name);
  // El secreto nunca sale del servidor: solo se indica si hay uno guardado.
  return rows.map(({ secretEnc, ...row }) => ({ ...row, hasSecret: Boolean(secretEnc) }));
}

export interface NewConnector {
  name: string;
  url: string;
  transport: "streamable-http" | "sse";
  authType: "none" | "bearer" | "header";
  headerName?: string | null;
  secret?: string | null;
  allowedTools?: string[] | null;
}

export type CreateConnectorResult = { ok: true; id: string } | { ok: false; error: string };

export async function createConnector(userId: string, input: NewConnector): Promise<CreateConnectorResult> {
  const checked = checkConnectorUrl(input.url, allowPrivateConnectors());
  if (!checked.ok) return checked;
  if (input.authType !== "none" && !input.secret) {
    return { ok: false, error: "Indica el secreto con el que autenticarse" };
  }
  if (input.authType === "header" && !/^[A-Za-z0-9-]{1,64}$/.test(input.headerName ?? "")) {
    return { ok: false, error: "El nombre de la cabecera no es válido" };
  }
  try {
    const [row] = await db
      .insert(connectors)
      .values({
        userId,
        name: input.name,
        url: checked.url,
        transport: input.transport,
        authType: input.authType,
        headerName: input.authType === "header" ? input.headerName : null,
        secretEnc: input.secret ? encryptSecret(input.secret) : null,
        allowedTools: input.allowedTools ?? null,
      })
      .returning({ id: connectors.id });
    return { ok: true, id: row.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, error: `Ya tienes un conector llamado «${input.name}»` };
    }
    throw error;
  }
}

export async function deleteConnector(userId: string, id: string): Promise<boolean> {
  const removed = await db
    .delete(connectors)
    .where(and(eq(connectors.id, id), eq(connectors.userId, userId)))
    .returning({ id: connectors.id });
  return removed.length > 0;
}

/**
 * Conectores que un agente usa, con los secretos descifrados, listos para el
 * sidecar. Solo se resuelven los del propio usuario que ejecuta el run: un
 * agente público no hereda los conectores de su autor.
 */
export async function resolveConnectors(userId: string, refs: AgentSpec["connectors"]): Promise<ConnectorLink[]> {
  if (refs.length === 0) return [];
  const rows = await db
    .select()
    .from(connectors)
    .where(and(eq(connectors.userId, userId), inArray(connectors.id, refs.map((ref) => ref.connectorId))));

  const links: ConnectorLink[] = [];
  for (const row of rows) {
    const ref = refs.find((item) => item.connectorId === row.id);
    let secret: string | null = null;
    if (row.secretEnc) {
      try {
        secret = decryptSecret(row.secretEnc);
      } catch {
        continue; // sin poder descifrar, el conector no se ofrece (mejor que fallar el run)
      }
    }
    links.push({
      id: row.id,
      name: row.name,
      url: row.url,
      transport: row.transport,
      headers: authHeaders(row.authType, secret, row.headerName),
      allowTools: ref?.allowTools?.length ? ref.allowTools : (row.allowedTools ?? undefined),
    });
  }
  return links;
}

/**
 * Conectores completos de un run: los MCP del usuario más, si el agente tiene
 * «ordenador» activado y está desplegado, su navegador aislado. Si el navegador
 * no se puede arrancar el run sigue sin él: es mejor que fallar.
 */
export async function connectorsForRun(
  userId: string,
  agentId: string | null,
  spec: AgentSpec,
): Promise<{ links: ConnectorLink[]; warning?: string }> {
  // Se comprueba aquí para cubrir también a los agentes creados antes de retirar el permiso.
  const account = await getUserAccess(userId);
  const links = account && hasPermission(account, "connectors") ? await resolveConnectors(userId, spec.connectors) : [];
  if (!agentId || !spec.computer.enabled || !account || !hasPermission(account, "computer")) return { links };
  const browser = await ensureBrowser(agentId);
  if (!browser.ok) return { links, warning: browser.error };
  return { links: [...links, browser.link] };
}
