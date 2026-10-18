import { EventType } from "@ag-ui/core";
import type { Event as AgUiEvent } from "@ag-ui/core";
import type { SourceItem } from "@/lib/sources";

/**
 * Tipos y constantes de AG-UI para Plexo.
 *
 * La fuente de verdad de los eventos es el paquete `@ag-ui/core`; aquí solo se
 * añaden los nombres propios de Plexo que viajan como eventos `CUSTOM`.
 */
export type { AgUiEvent };
export { EventType };

/** Fuentes citadas de un turno. `value: PlexoSourcesPayload`. */
export const PLEXO_SOURCES = "plexo.sources";

/** Decisión de política de una acción. `value: PlexoPolicyPayload`. */
export const PLEXO_POLICY = "plexo.policy";

/** Tipo de actividad con el que Research publica su plan. */
export const PLEXO_ACTIVITY_PLAN = "PLAN";

export interface PlexoSourcesPayload {
  sources: SourceItem[];
}

export interface PlexoPolicyPayload {
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
