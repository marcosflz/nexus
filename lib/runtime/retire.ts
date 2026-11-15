import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sandboxConfig } from "@/lib/sandbox/client";
import { signSidecarRequest } from "@/lib/internal/token";

/** Migration retains these IDs until sandboxd confirms their legacy environments are gone. */
export async function retireAgentEnvironments(): Promise<void> {
  const config = sandboxConfig();
  if (!config) return;
  const rows = await db.execute<{ agent_id: string }>(sql`SELECT agent_id FROM retired_agent_workspaces`);
  for (const row of rows) {
    const response = await fetch(`${config.url}/v1/workspaces/${row.agent_id}/destroy?purge=true`, {
      method: "POST", body: "", headers: signSidecarRequest(""), signal: AbortSignal.timeout(40_000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`No se pudo retirar el antiguo entorno ${row.agent_id}`);
    await db.execute(sql`DELETE FROM retired_agent_workspaces WHERE agent_id = ${row.agent_id}`);
  }
}
