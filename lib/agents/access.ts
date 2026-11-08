import type { AgentVisibility } from "@/lib/db/schema";

export interface AccessSubject {
  ownerId: string;
  visibility: AgentVisibility;
}

/** Cualquier usuario puede *usar* un agente público o con enlace; solo el dueño lo edita. */
export function canUseAgent(userId: string, agent: AccessSubject): boolean {
  return agent.ownerId === userId || agent.visibility === "public" || agent.visibility === "unlisted";
}

export function canEditAgent(userId: string, agent: AccessSubject): boolean {
  return agent.ownerId === userId;
}

/** Solo los públicos aparecen en la galería de otros usuarios. */
export function isListedFor(userId: string, agent: AccessSubject): boolean {
  return agent.ownerId === userId || agent.visibility === "public";
}
