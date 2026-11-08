import { EventType } from "@ag-ui/core";
import type { AgUiEvent } from "@/lib/agui/events";
import type { BusMessage, RunBus } from "./bus";
import type { RunStatus } from "./types";

export const KEEPALIVE_MS = 15_000;

export interface TailDeps {
  bus: RunBus;
  getEventsAfter(runId: string, after: number): Promise<{ seq: number; payload: unknown }[]>;
  getStatus(runId: string): Promise<{ status: RunStatus; leaseUntil: Date | null } | null>;
  isActive(runId: string): boolean;
  /** El tail dio el run por huérfano: que alguien cierre su estado en la base de datos. */
  onOrphan?(runId: string): void | Promise<void>;
  keepaliveMs?: number;
}

export interface TailOptions {
  runId: string;
  /** Solo se envían eventos con `seq` mayor. */
  after: number;
  signal?: AbortSignal;
}

export function isTerminalEvent(event: AgUiEvent): boolean {
  return event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
}

/** Fin de una pausa (aprobación, formulario): el run sigue vivo y puede reanudarse. */
export function isInterruptFinish(event: AgUiEvent): boolean {
  if (event.type !== EventType.RUN_FINISHED) return false;
  return (event as { outcome?: { type?: string } }).outcome?.type === "interrupt";
}

/** Un evento AG-UI como frame SSE: `id` = seq, `data` = el evento. */
export function encodeFrame(seq: number, event: unknown): string {
  return `id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Sigue un run: primero el backlog guardado, luego el directo.
 *
 * Se suscribe al bus **antes** de leer la base de datos y deduplica por `seq`;
 * como el ejecutor persiste antes de publicar, no puede quedar ningún hueco.
 * Termina al ver `RUN_FINISHED`/`RUN_ERROR`. Si el run murió sin dejar un evento
 * terminal (caída del proceso), cierra con un `RUN_ERROR` sintético.
 */
export function tailRun(deps: TailDeps, { runId, after, signal }: TailOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastSeq = after;
      let closed = false;
      let live = false;
      const buffered: BusMessage[] = [];

      const finish = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          /* ya cerrado por el consumidor */
        }
      };

      const deliver = (seq: number, event: AgUiEvent, hasMore = false) => {
        if (closed || seq <= lastSeq) return;
        lastSeq = seq;
        try {
          controller.enqueue(encoder.encode(encodeFrame(seq, event)));
        } catch {
          finish();
          return;
        }
        // Una pausa que ya tiene eventos detrás es una pausa superada (el run se
        // reanudó): hay que seguir hasta el final real.
        if (isTerminalEvent(event) && !(isInterruptFinish(event) && hasMore)) finish();
      };

      const unsubscribe = deps.bus.subscribe(runId, (message) => {
        if (live) deliver(message.seq, message.event);
        else buffered.push(message);
      });

      const keepalive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          finish();
          return;
        }
        void checkOrphan();
      }, deps.keepaliveMs ?? KEEPALIVE_MS);

      const onAbort = () => finish();
      signal?.addEventListener("abort", onAbort, { once: true });

      cleanup = () => {
        unsubscribe();
        clearInterval(keepalive);
        signal?.removeEventListener("abort", onAbort);
      };

      /** ¿El run terminó sin que viéramos el evento terminal? */
      async function checkOrphan() {
        if (closed || !live) return;
        const meta = await deps.getStatus(runId);
        if (closed || !meta) return;

        const stillRunning =
          meta.status === "running" &&
          (deps.isActive(runId) || (meta.leaseUntil !== null && meta.leaseUntil > new Date()));
        if (stillRunning) return;

        // Pudo cerrarse justo ahora: relee antes de dar el run por huérfano.
        for (const row of await deps.getEventsAfter(runId, lastSeq)) {
          deliver(row.seq, row.payload as AgUiEvent);
        }
        if (closed) return;

        void Promise.resolve(deps.onOrphan?.(runId)).catch(() => {});
        deliver(lastSeq + 1, {
          type: EventType.RUN_ERROR,
          message: "El turno se interrumpió antes de terminar.",
          code: "interrupted",
        } as AgUiEvent);
        finish();
      }

      try {
        const backlog = await deps.getEventsAfter(runId, after);
        backlog.forEach((row, index) =>
          deliver(row.seq, row.payload as AgUiEvent, index < backlog.length - 1),
        );
        live = true;
        for (const message of buffered.sort((a, b) => a.seq - b.seq)) {
          deliver(message.seq, message.event);
        }
        buffered.length = 0;
        await checkOrphan();
      } catch (error) {
        console.error("[nexus] no se pudo seguir el run:", error);
        finish();
      }
    },

    cancel() {
      cleanup();
    },
  });
}
