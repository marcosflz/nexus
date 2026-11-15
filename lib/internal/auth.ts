import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { runs } from "@/lib/db/schema";
import type { RunInitiator } from "@/lib/runs/types";
import { verifyRunToken, type RunTokenClaims } from "./token";

export interface InternalRun {
  botId: string | null;
  runtimeSnapshot: import("@/lib/db/schema").RuntimeSnapshot | null;
  id: string;
  threadId: string;
  userId: string;
  initiator: RunInitiator;
  agentId: string | null;
}

export type InternalAuth =
  | { ok: true; claims: RunTokenClaims; run: InternalRun }
  | { ok: false; response: Response };

const deny = (status: number, error: string): InternalAuth => ({
  ok: false,
  response: Response.json({ error }, { status }),
});

/**
 * Autentica una llamada del sidecar a `/api/internal/*`.
 *
 * Solo vale el token de run firmado por el BFF (nunca la cookie de sesión), y
 * además el run debe existir, ser del mismo usuario y seguir en marcha: un
 * token filtrado deja de servir en cuanto el run termina.
 */
export async function authenticateInternal(req: Request): Promise<InternalAuth> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const claims = token ? verifyRunToken(token) : null;
  if (!claims) return deny(401, "Token de run no válido");

  const [row] = await db
    .select({
      id: runs.id,
      threadId: runs.threadId,
      userId: runs.userId,
      initiator: runs.initiator,
      agentId: runs.agentId,
      botId: runs.botId,
      runtimeSnapshot: runs.runtimeSnapshot,
      status: runs.status,
    })
    .from(runs)
    .where(and(eq(runs.id, claims.runId), eq(runs.userId, claims.userId)))
    .limit(1);

  if (!row) return deny(401, "Run no encontrado");
  if (row.status !== "running") return deny(409, "El run ya no está en marcha");

  return {
    ok: true,
    claims,
    run: {
      id: row.id,
      threadId: row.threadId,
      userId: row.userId,
      initiator: row.initiator as InternalRun["initiator"],
      agentId: row.agentId,
      botId: row.botId,
      runtimeSnapshot: row.runtimeSnapshot,
    },
  };
}
