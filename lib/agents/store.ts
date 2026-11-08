import { and, desc, eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  agents,
  agentVersions,
  type AgentStatus,
  type AgentVisibility,
} from "@/lib/db/schema";
import { canEditAgent, canUseAgent } from "./access";
import { slugify, uniqueSlug } from "./slug";
import { agentSpecSchema, type AgentSpec, type AgentSpecInput } from "./spec";

export type AgentRow = typeof agents.$inferSelect;

export interface ResolvedAgent {
  agent: AgentRow;
  versionId: string;
  version: number;
  spec: AgentSpec;
}

async function slugsOf(ownerId: string): Promise<string[]> {
  const rows = await db.select({ slug: agents.slug }).from(agents).where(eq(agents.ownerId, ownerId));
  return rows.map((row) => row.slug);
}

/** Crea el agente y su versión 1. Lanza si el spec no es válido. */
export async function createAgent(
  ownerId: string,
  input: AgentSpecInput,
  meta: { description?: string; visibility?: AgentVisibility } = {},
): Promise<ResolvedAgent> {
  const spec = agentSpecSchema.parse(input);
  const slug = uniqueSlug(slugify(spec.name), await slugsOf(ownerId));

  return db.transaction(async (tx) => {
    const [agent] = await tx
      .insert(agents)
      .values({
        ownerId,
        slug,
        name: spec.name,
        avatar: spec.avatar,
        description: meta.description ?? spec.role,
        visibility: meta.visibility ?? "private",
      })
      .returning();
    const [version] = await tx
      .insert(agentVersions)
      .values({ agentId: agent.id, version: 1, spec, createdBy: ownerId })
      .returning();
    const [updated] = await tx
      .update(agents)
      .set({ currentVersionId: version.id })
      .where(eq(agents.id, agent.id))
      .returning();
    return { agent: updated, versionId: version.id, version: 1, spec };
  });
}

/**
 * Publica una versión nueva. Las anteriores no se tocan: los runs en curso o
 * programados con una versión antigua siguen siendo reproducibles.
 */
export async function publishVersion(
  userId: string,
  agentId: string,
  input: AgentSpecInput,
): Promise<ResolvedAgent | null> {
  const spec = agentSpecSchema.parse(input);
  return db.transaction(async (tx) => {
    const [agent] = await tx.select().from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!agent || !canEditAgent(userId, agent)) return null;

    const [latest] = await tx
      .select({ version: agentVersions.version })
      .from(agentVersions)
      .where(eq(agentVersions.agentId, agentId))
      .orderBy(desc(agentVersions.version))
      .limit(1);
    const next = (latest?.version ?? 0) + 1;

    const [version] = await tx
      .insert(agentVersions)
      .values({ agentId, version: next, spec, createdBy: userId })
      .returning();
    const [updated] = await tx
      .update(agents)
      .set({
        currentVersionId: version.id,
        name: spec.name,
        avatar: spec.avatar,
        updatedAt: new Date(),
      })
      .where(eq(agents.id, agentId))
      .returning();
    return { agent: updated, versionId: version.id, version: next, spec };
  });
}

export async function updateAgentMeta(
  userId: string,
  agentId: string,
  patch: { description?: string; visibility?: AgentVisibility; status?: AgentStatus },
): Promise<AgentRow | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || !canEditAgent(userId, agent)) return null;
  const [updated] = await db
    .update(agents)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(agents.id, agentId))
    .returning();
  return updated;
}

export async function deleteAgent(userId: string, agentId: string): Promise<boolean> {
  const removed = await db
    .delete(agents)
    .where(and(eq(agents.id, agentId), eq(agents.ownerId, userId)))
    .returning({ id: agents.id });
  return removed.length > 0;
}

/** Agente con su versión vigente, si la persona puede usarlo. */
export async function resolveAgent(userId: string, agentId: string): Promise<ResolvedAgent | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || !canUseAgent(userId, agent) || !agent.currentVersionId) return null;
  return loadVersion(agent, agent.currentVersionId);
}

/** Agente con una versión concreta (para reproducir un run programado). Sin comprobar permisos. */
export async function loadVersion(agent: AgentRow, versionId: string): Promise<ResolvedAgent | null> {
  const [row] = await db
    .select()
    .from(agentVersions)
    .where(and(eq(agentVersions.id, versionId), eq(agentVersions.agentId, agent.id)))
    .limit(1);
  if (!row) return null;
  // Una versión guardada con un schema antiguo se vuelve a normalizar al leerla.
  const parsed = agentSpecSchema.safeParse(row.spec);
  if (!parsed.success) return null;
  return { agent, versionId: row.id, version: row.version, spec: parsed.data };
}

/** Busca por slug entre los agentes que el usuario puede usar (para `@mención`). */
export async function resolveBySlug(userId: string, slug: string): Promise<ResolvedAgent | null> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, slug), or(eq(agents.ownerId, userId), eq(agents.visibility, "public"))))
    .orderBy(desc(eq(agents.ownerId, userId)))
    .limit(1);
  if (!agent?.currentVersionId || agent.status !== "active") return null;
  return loadVersion(agent, agent.currentVersionId);
}

export async function listAgentsFor(userId: string) {
  const rows = await db
    .select()
    .from(agents)
    .where(or(eq(agents.ownerId, userId), eq(agents.visibility, "public")))
    .orderBy(desc(agents.updatedAt))
    .limit(200);
  return rows.map((agent) => ({ ...agent, mine: agent.ownerId === userId }));
}

export async function listVersions(userId: string, agentId: string) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  if (!agent || !canEditAgent(userId, agent)) return null;
  return db
    .select({ id: agentVersions.id, version: agentVersions.version, createdAt: agentVersions.createdAt })
    .from(agentVersions)
    .where(eq(agentVersions.agentId, agentId))
    .orderBy(desc(agentVersions.version));
}

/** Copia un agente al usuario (con su spec actual). El conocimiento no se copia. */
export async function duplicateAgent(userId: string, agentId: string): Promise<ResolvedAgent | null> {
  const source = await resolveAgent(userId, agentId);
  if (!source) return null;
  const spec: AgentSpecInput = {
    ...source.spec,
    name: source.agent.ownerId === userId ? `${source.spec.name} (copia)` : source.spec.name,
    // El conocimiento y los conectores son del dueño original: no viajan con la copia.
    connectors: [],
    knowledge: { ...source.spec.knowledge, enabled: false },
  };
  return createAgent(userId, spec, { description: source.agent.description });
}

/** Versión concreta de un agente por ids (para reanudar o reproducir un run). */
export async function loadAgentVersion(agentId: string, versionId: string): Promise<ResolvedAgent | null> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  return agent ? loadVersion(agent, versionId) : null;
}
