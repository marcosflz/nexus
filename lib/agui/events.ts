import { EventType } from "@ag-ui/core";
import type { Event as AgUiEvent } from "@ag-ui/core";
import type { SourceItem } from "@/lib/sources";

/**
 * Tipos y constantes de AG-UI para Nexus.
 *
 * La fuente de verdad de los eventos es el paquete `@ag-ui/core`; aquí solo se
 * añaden los nombres propios de Nexus que viajan como eventos `CUSTOM`.
 */
export type { AgUiEvent };
export { EventType };

/** Fuentes citadas de un turno. `value: NexusSourcesPayload`. */
export const NEXUS_SOURCES = "nexus.sources";

/** Decisión de política de una acción. `value: NexusPolicyPayload`. */
export const NEXUS_POLICY = "nexus.policy";

/** Preguntas de seguimiento propuestas por el agente. `value: { questions }`. */
export const NEXUS_FOLLOWUPS = "nexus.followups";
/** Fragmento del razonamiento que publica el modelo: `{ delta }`. No forma parte de la respuesta. */
export const NEXUS_REASONING = "nexus.reasoning";

/** Id del mensaje del asistente ya persistido. `value: { messageId }`. */
export const NEXUS_MESSAGE = "nexus.message";

/**
 * Nombres que usaba el proyecto cuando se llamaba Plexo. Los `run_events` ya
 * guardados los conservan, así que el reducer debe seguir entendiéndolos.
 */
export const LEGACY_SOURCES = "plexo.sources";
export const LEGACY_POLICY = "plexo.policy";

/** Tipo de actividad con el que Research publica su plan. */
export const NEXUS_ACTIVITY_PLAN = "PLAN";

export interface NexusFollowupsPayload {
  questions: string[];
}

export interface NexusMessagePayload {
  messageId: string;
}

export interface NexusSourcesPayload {
  sources: SourceItem[];
}

export interface NexusPolicyPayload {
  tool: string;
  effect: "allow" | "ask" | "deny";
  rule: string;
  reason?: string;
}

/**
 * Ancho de banda mínimo de un evento: el discriminante. Se usa para tipar los
 * helpers de reducción sin depender de la forma exacta de cada evento.
 */
export type AgUiEventType = AgUiEvent["type"];
