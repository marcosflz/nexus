import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { agentWorkspaces } from "@/lib/db/schema";

/** ¿Hay una persona conduciendo el navegador de este agente ahora mismo? */
export async function isHumanInControl(agentId: string | null): Promise<boolean> {
  if (!agentId) return false;
  const [row] = await db
    .select({ humanControl: agentWorkspaces.humanControl })
    .from(agentWorkspaces)
    .where(eq(agentWorkspaces.agentId, agentId))
    .limit(1);
  return row?.humanControl ?? false;
}

/** Activa o desactiva «persona al mando». Crea el registro del espacio si aún no existe. */
export async function setHumanControl(agentId: string, control: boolean): Promise<void> {
  await db
    .insert(agentWorkspaces)
    .values({
      agentId,
      containerName: `nexus-sbx-${agentId.slice(0, 8)}`,
      volume: `nexus-sbx-data-${agentId}`,
      humanControl: control,
    })
    .onConflictDoUpdate({ target: agentWorkspaces.agentId, set: { humanControl: control } });
}
