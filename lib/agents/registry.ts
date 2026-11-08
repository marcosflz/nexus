import type { AgentBackend } from "./backend";
import { nasAdkBackend, nasAdkConfig } from "./backends/nas-adk";

/**
 * Motor de agentes de Nexus: el sidecar nas-adk. Se accede a través de este
 * módulo para que las rutas no dependan del transporte concreto.
 */
export function getBackend(): AgentBackend {
  return nasAdkBackend;
}

/** El sidecar está configurado (`NEXUS_AGENT_URL` y `NEXUS_AGENT_SECRET`). */
export function isBackendAvailable(): boolean {
  return nasAdkConfig() !== null;
}

export const BACKEND_UNAVAILABLE =
  "El motor de agentes no está configurado: define NEXUS_AGENT_URL y NEXUS_AGENT_SECRET";
