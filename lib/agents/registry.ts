import type { AgentBackend } from "./backend";
import { hermesBackend } from "./backends/hermes";
import { nasAdkBackend, nasAdkConfig } from "./backends/nas-adk";

export type BackendId = AgentBackend["id"];

const backends: Record<string, AgentBackend> = {
  [hermesBackend.id]: hermesBackend,
  [nasAdkBackend.id]: nasAdkBackend,
};

export function isBackendId(value: unknown): value is BackendId {
  return typeof value === "string" && value in backends;
}

export function getBackend(id: string): AgentBackend {
  const backend = backends[id];
  if (!backend) throw new Error(`Motor de agente desconocido: ${id}`);
  return backend;
}

/** Hermes siempre está; nas-adk solo si el sidecar está configurado. */
export function isBackendAvailable(id: string): boolean {
  if (id === "nas-adk") return nasAdkConfig() !== null;
  return id in backends;
}

/** Motor por defecto: `NEXUS_BACKEND_DEFAULT` si existe y está disponible; si no, Hermes. */
export function defaultBackendId(): BackendId {
  const configured = process.env.NEXUS_BACKEND_DEFAULT?.trim();
  if (isBackendId(configured) && isBackendAvailable(configured)) return configured;
  return hermesBackend.id;
}

export function describeBackends() {
  return [
    { id: "hermes" as const, label: "Hermes", available: true },
    { id: "nas-adk" as const, label: "nas-adk (UI generativa e interactiva)", available: isBackendAvailable("nas-adk") },
  ];
}
