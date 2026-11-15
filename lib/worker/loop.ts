import { randomUUID } from "node:crypto";
import { launchRoutineRun, maxConcurrentRuns } from "@/lib/runs/routine";
import { activeRunCount } from "@/lib/runs/registry";
import { dispatchAllRooms } from "@/lib/rooms/engine";
import { pollTrigger } from "@/lib/triggers/poll";
import { scheduleDueTriggers } from "@/lib/triggers/service";
import { claimJobs, completeJob, deferJob, failJob, reclaimStaleJobs, type JobRow } from "./jobs";

export const TICK_MS = 5000;
const DEFER_MS = 30_000;

/** Ejecuta un trabajo. Lanzar = reintentar con backoff; devolver `"defer"` = volver a la cola sin gastar intento. */
export async function handleJob(job: JobRow): Promise<"done" | "defer"> {
  const payload = job.payload as Record<string, unknown>;

  if (job.kind === "trigger_poll") {
    const result = await pollTrigger(String(payload.triggerId));
    if (result.retry) return "defer";
    if (result.error && !result.fired) throw new Error(result.error);
    return "done";
  }

  if (job.kind === "bot_run") {
    const outcome = await launchRoutineRun({
      botId: String(payload.botId),
      triggerId: typeof payload.triggerId === "string" ? payload.triggerId : null,
      prompt: String(payload.prompt ?? ""),
      context: typeof payload.context === "string" ? payload.context : undefined,
      source: String(payload.source ?? "automático"),
      chainDepth: Number(payload.chainDepth) || 0,
    });
    if (outcome.ok) return "done";
    if (outcome.retry) return "defer";
    // Pausa, presupuesto o credencial: ya se notificó y reintentar no lo arregla.
    return "done";
  }

  return "done";
}

/**
 * Ejecuta las etapas de un ciclo aislando los fallos: que falle una (p. ej. la
 * planificación de disparadores) no impide las demás (reclamar trabajos).
 * Devuelve los errores para poder registrarlos.
 */
export async function runStages(stages: [string, () => Promise<unknown>][]): Promise<{ stage: string; error: unknown }[]> {
  const failures: { stage: string; error: unknown }[] = [];
  for (const [stage, fn] of stages) {
    try {
      await fn();
    } catch (error) {
      failures.push({ stage, error });
    }
  }
  return failures;
}

export interface Worker {
  stop(): Promise<void>;
}

/**
 * Bucle del worker: planifica disparadores vencidos, reclama trabajos con
 * `SKIP LOCKED` y los ejecuta respetando el límite de runs simultáneos.
 */
export function startWorker(options: { tickMs?: number; workerId?: string } = {}): Worker {
  const workerId = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  const inFlight = new Set<Promise<void>>();
  let stopped = false;
  let ticking = false;

  const run = async (job: JobRow) => {
    try {
      const verdict = await handleJob(job);
      if (verdict === "defer") await deferJob(job, DEFER_MS);
      else await completeJob(job.id);
    } catch (error) {
      await failJob(job, error instanceof Error ? error.message : String(error)).catch(() => {});
    }
  };

  const tick = async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const failures = await runStages([
        ["reclamar trabajos huérfanos", () => reclaimStaleJobs()],
        ["planificar disparadores", () => scheduleDueTriggers()],
        // Turnos de sala que esperaban hueco, a su bot o a que el servidor volviese.
        ["despachar salas de NexBots", () => dispatchAllRooms()],
        [
          "ejecutar trabajos",
          async () => {
            // Se reclama solo lo que cabe: un trabajo reclamado y sin hueco gastaría un intento.
            const slots = Math.max(0, maxConcurrentRuns() - activeRunCount() - inFlight.size);
            for (const job of await claimJobs(workerId, Math.min(slots, 5))) {
              const task = run(job).finally(() => inFlight.delete(task));
              inFlight.add(task);
            }
          },
        ],
      ]);
      for (const { stage, error } of failures) console.error(`[nexus] error en el worker (${stage}):`, error);
    } catch (error) {
      console.error("[nexus] error inesperado en el ciclo del worker:", error);
    } finally {
      ticking = false;
    }
  };

  const timer = setInterval(() => void tick(), options.tickMs ?? TICK_MS);
  void tick();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await Promise.allSettled([...inFlight]);
    },
  };
}
