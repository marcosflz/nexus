/**
 * Política de acciones del agente.
 *
 * El motor es fail-closed: si ninguna regla permite una acción, se deniega.
 * La precedencia es `deny` > `ask` > `allow`, independientemente del orden en
 * que las reglas estén declaradas.
 */

export type ActionKind = "web" | "browser" | "file" | "terminal" | "agent" | "connector";

export interface ActionTarget {
  url?: string;
  host?: string;
  path?: string;
  command?: string;
}

export interface ActionRequest {
  kind: ActionKind;
  /** Nombre de la herramienta, tal y como lo emite el agente (p. ej. `browser_click`). */
  tool: string;
  args: unknown;
  target?: ActionTarget;
  runId: string;
  threadId: string;
  userId: string;
  /** Quién provocó la acción: una persona o una rutina programada. */
  initiator: "user" | "routine";
  /** Hay una persona conduciendo el navegador en este momento. */
  humanInControl?: boolean;
}

export type PolicyEffect = "allow" | "ask" | "deny";

export interface PolicyDecision {
  effect: PolicyEffect;
  /** Identificador de la regla que decidió. Se persiste en la auditoría. */
  rule: string;
  reason?: string;
  /** Claves de `args` que no deben guardarse en claro en la auditoría. */
  redact?: string[];
}

export interface PolicyRule {
  id: string;
  effect: PolicyEffect;
  reason?: string;
  /** Predicado puro. Si lanza, la acción se deniega. */
  when: (req: ActionRequest) => boolean;
}
