import type { TokenUsage } from "@/lib/agents/usage";

/**
 * Ciclo de vida de un turno.
 *
 * `interrupted` es distinto de `error` a propósito: un run interrumpido pudo
 * haber producido efectos (ficheros, navegación, correos) antes de cortarse, y
 * la UI debe pedir revisión en vez de ofrecer un reintento ciego.
 */
export type RunStatus =
  | "running"
  | "awaiting_input"
  | "completed"
  | "interrupted"
  | "error"
  | "cancelled";

/**
 * `awaiting_input` es un run en pausa a propósito (aprobación o formulario del
 * usuario) y se reanuda con `resume`. No es lo mismo que `interrupted`, que
 * significa que el proceso murió a mitad del turno.
 */

export type RunInitiator = "user" | "routine" | "trigger";

export interface Run {
  id: string;
  threadId: string;
  userId: string;
  status: RunStatus;
  initiator: RunInitiator;
  backend: string | null;
  agentId: string | null;
  agentVersionId: string | null;
  agentSessionId: string | null;
  leaseUntil: Date | null;
  heartbeatAt: Date | null;
  lastSeq: number;
  error: string | null;
  usage: TokenUsage | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RunEventRecord {
  runId: string;
  seq: number;
  type: string;
  payload: unknown;
  createdAt: Date;
}

export type RunTransition =
  | { kind: "started"; at: Date }
  | { kind: "finished"; at: Date; interrupted: boolean }
  | { kind: "awaiting-input"; at: Date }
  | { kind: "error"; at: Date }
  | { kind: "cancelled"; at: Date }
  | { kind: "lease-expired"; at: Date };

/** Un run se considera vivo mientras su lease no haya vencido. */
export const RUN_LEASE_MS = 60_000;
export const RUN_HEARTBEAT_MS = 15_000;

/**
 * Transición pura del estado de un run.
 *
 * Regla fail-safe: un run en `running` cuyo lease vence pasa a `interrupted`,
 * nunca a `completed`, porque no hay prueba de que el trabajo terminase.
 */
export function nextRunState(status: RunStatus, transition: RunTransition): RunStatus {
  switch (transition.kind) {
    case "started":
      // Un run ya cerrado no vuelve a `running`: eso sería reescribir historia.
      return status === "running" ? "running" : status;
    case "finished":
      return transition.interrupted ? "interrupted" : "completed";
    case "awaiting-input":
      return status === "running" ? "awaiting_input" : status;
    case "error":
      return "error";
    case "cancelled":
      return "cancelled";
    case "lease-expired":
      return status === "running" ? "interrupted" : status;
  }
}

/** Estados terminales: el run ya no va a producir más eventos. */
export function isTerminalStatus(status: RunStatus): boolean {
  return (
    status === "completed" ||
    status === "interrupted" ||
    status === "error" ||
    status === "cancelled"
  );
}

export function isLeaseExpired(
  run: Pick<Run, "status" | "leaseUntil">,
  now: Date = new Date(),
): boolean {
  if (run.status !== "running") return false;
  if (!run.leaseUntil) return true;
  return run.leaseUntil.getTime() < now.getTime();
}
