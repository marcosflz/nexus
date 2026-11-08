import { EventType } from "@ag-ui/core";
import { NEXUS_MESSAGE, type AgUiEvent } from "@/lib/agui/events";
import { reduceAgUiAll } from "@/lib/agui/reducer";
import type { AgentBackend, BackendRunInput, BackendRunResult } from "@/lib/agents/backend";
import type { PersistedPart, PersistedTool } from "@/lib/db/schema";
import type { TokenUsage } from "@/lib/agents/usage";
import type { SourceItem } from "@/lib/sources";
import type { RunBus } from "./bus";
import { finalizeAssistantMessage } from "./finalize";
import { RUN_HEARTBEAT_MS, type RunStatus } from "./types";
import type { FinishOptions, NewRunEvent } from "./store";

/** Todo lo que el ejecutor necesita del exterior. Se sustituye en los tests. */
export interface ExecutorDeps {
  appendEvents(runId: string, events: NewRunEvent[]): Promise<void>;
  heartbeat(runId: string, lastSeq: number): Promise<void>;
  finishRun(
    runId: string,
    transition: {
      kind: "finished" | "error" | "cancelled" | "awaiting-input";
      interrupted?: boolean;
    },
    options?: FinishOptions,
  ): Promise<RunStatus>;
  saveAssistantMessage(message: {
    threadId: string;
    runId: string;
    content: string;
    sources: SourceItem[];
    tools: PersistedTool[];
    parts: PersistedPart[] | null;
    followups: string[] | null;
    usage: TokenUsage | null;
  }): Promise<string>;
  bus: RunBus;
  /** Se llama al terminar el run (con éxito, error, cancelación o pausa). Nunca debe lanzar. */
  onFinished?(info: FinishedInfo): void | Promise<void>;
  /** Ventana de agrupado de deltas de texto. 0 desactiva el agrupado. */
  flushMs?: number;
  heartbeatMs?: number;
}

export interface FinishedInfo {
  runId: string;
  threadId: string;
  userId: string;
  initiator: BackendRunInput["initiator"];
  agentId: string | null;
  agentName: string;
  outcome: "success" | "error" | "cancelled" | "interrupt";
  /** Texto final (éxito) o motivo (error). */
  text: string;
  interrupts?: { id: string; reason: string; toolName?: string }[];
}

export interface ExecuteRunInput {
  backend: AgentBackend;
  input: BackendRunInput;
  /**
   * Al reanudar un run en pausa: lo ya registrado. La ejecución continúa el
   * mismo log (mismo `seq`) y el mensaje final incluye lo anterior a la pausa.
   */
  seed?: { events: AgUiEvent[]; lastSeq: number };
}

export const DEFAULT_FLUSH_MS = 75;
export const CANCELLED_CODE = "cancelled";

function toAgUiUsage(usage: TokenUsage | undefined): unknown[] | undefined {
  if (!usage) return undefined;
  return [
    {
      inputTokens: usage.input ?? 0,
      outputTokens: usage.output ?? 0,
      totalTokens: usage.total ?? (usage.input ?? 0) + (usage.output ?? 0),
      cachedInputTokens: usage.cache_read ?? 0,
      cacheWriteInputTokens: usage.cache_write ?? 0,
    },
  ];
}

/**
 * Ejecuta un run de principio a fin, independientemente de la petición HTTP.
 *
 * Orden de cada evento: se numera, se **persiste** y solo entonces se publica
 * en el bus (ver `RunBus`). Los deltas de texto se agrupan en ventanas cortas
 * para no escribir una fila de Postgres por token.
 */
export async function executeRun(
  deps: ExecutorDeps,
  { backend, input, seed }: ExecuteRunInput,
  signal: AbortSignal,
): Promise<void> {
  const { runId, threadId } = input;
  const flushMs = deps.flushMs ?? DEFAULT_FLUSH_MS;

  const history: AgUiEvent[] = seed ? [...seed.events] : [];
  const queue: NewRunEvent[] = [];
  let seq = seed?.lastSeq ?? 0;
  let lastPersistedSeq = seq;

  let pendingText: { messageId: string; delta: string } | null = null;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Escritor serie: garantiza que los lotes se persisten y publican en orden.
  let writer: Promise<void> = Promise.resolve();
  let writeError: unknown = null;

  const drain = (): Promise<void> => {
    writer = writer.then(async () => {
      if (queue.length === 0) return;
      const batch = queue.splice(0, queue.length);
      try {
        await deps.appendEvents(runId, batch);
        lastPersistedSeq = batch[batch.length - 1].seq;
      } catch (error) {
        // Si Postgres falla, quien sigue el run en vivo debe seguir viendo la
        // respuesta; solo se pierde la posibilidad de reanudarla desde el log.
        writeError = error;
        console.error("[nexus] no se pudieron guardar los eventos del run:", error);
      }
      for (const record of batch) {
        deps.bus.publish(runId, { seq: record.seq, event: record.payload as AgUiEvent });
      }
    });
    return writer;
  };

  const push = (event: AgUiEvent) => {
    seq += 1;
    history.push(event);
    queue.push({ seq, type: String(event.type), payload: event });
    void drain();
  };

  const flushText = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!pendingText) return;
    const { messageId, delta } = pendingText;
    pendingText = null;
    push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta } as AgUiEvent);
  };

  const emit = (event: AgUiEvent) => {
    if (event.type === EventType.TEXT_MESSAGE_CONTENT && flushMs > 0) {
      const { messageId, delta } = event as { messageId: string; delta: string };
      if (pendingText && pendingText.messageId !== messageId) flushText();
      pendingText = pendingText
        ? { messageId, delta: pendingText.delta + delta }
        : { messageId, delta };
      flushTimer ??= setTimeout(flushText, flushMs);
      return;
    }

    flushText();
    push(event);
  };

  const notifyFinished = async (
    outcome: FinishedInfo["outcome"],
    text: string,
    interrupts?: FinishedInfo["interrupts"],
  ) => {
    try {
      await deps.onFinished?.({
        runId,
        threadId,
        userId: input.userId,
        initiator: input.initiator,
        agentId: input.agent?.id ?? null,
        agentName: input.agent?.spec.name ?? "Nexus",
        outcome,
        text,
        interrupts,
      });
    } catch (error) {
      console.error("[nexus] el gancho de fin de run falló:", error);
    }
  };

  const heartbeat = setInterval(() => {
    void deps.heartbeat(runId, lastPersistedSeq).catch(() => {});
  }, deps.heartbeatMs ?? RUN_HEARTBEAT_MS);

  push({ type: EventType.RUN_STARTED, threadId, runId } as AgUiEvent);

  let result: BackendRunResult | null = null;
  let failure: unknown = null;
  try {
    result = await backend.run(input, emit, signal);
  } catch (error) {
    failure = error;
  }

  flushText();

  try {
    if (failure !== null || result === null) {
      const cancelled = signal.aborted;
      const message = cancelled
        ? "Generación cancelada"
        : failure instanceof Error
          ? failure.message
          : "Error desconocido";
      push({
        type: EventType.RUN_ERROR,
        message,
        ...(cancelled ? { code: CANCELLED_CODE } : {}),
      } as AgUiEvent);
      await drain();
      await deps.finishRun(
        runId,
        { kind: cancelled ? "cancelled" : "error" },
        { error: message, lastSeq: seq },
      );
      await notifyFinished(cancelled ? "cancelled" : "error", message);
      return;
    }

    if (result.outcome === "interrupt") {
      push({
        type: EventType.RUN_FINISHED,
        threadId,
        runId,
        outcome: { type: "interrupt", interrupts: result.interrupts ?? [] },
        usage: toAgUiUsage(result.usage),
      } as AgUiEvent);
      await drain();
      await deps.finishRun(
        runId,
        { kind: "awaiting-input" },
        {
          usage: result.usage ?? null,
          lastSeq: seq,
          outcome: { type: "interrupt", interrupts: result.interrupts ?? [] },
          checkpoint: result.checkpoint ?? null,
        },
      );
      await notifyFinished("interrupt", "", result.interrupts);
      return;
    }

    // Éxito: se persiste el mensaje antes de anunciar el fin, de modo que quien
    // recargue al ver RUN_FINISHED ya encuentra el mensaje en la base de datos.
    const state = reduceAgUiAll(history, `msg-${runId}`);
    const finalized = finalizeAssistantMessage(state, result.finalText);
    // Los follow-ups llegan como evento o dentro del resultado; el evento manda.
    const followups = state.message.followups?.length
      ? state.message.followups
      : (result.followups ?? []);
    const messageId = await deps.saveAssistantMessage({
      threadId,
      runId,
      content: finalized.content,
      sources: result.sources,
      tools: finalized.tools,
      parts: finalized.parts,
      followups: followups.length > 0 ? followups : null,
      usage: result.usage ?? null,
    });

    push({ type: EventType.CUSTOM, name: NEXUS_MESSAGE, value: { messageId } } as AgUiEvent);
    push({
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      outcome: { type: "success" },
      usage: toAgUiUsage(result.usage),
    } as AgUiEvent);
    await drain();
    await deps.finishRun(
      runId,
      { kind: "finished" },
      { usage: result.usage ?? null, lastSeq: seq, outcome: { type: "success" } },
    );
    await notifyFinished("success", finalized.content);
  } catch (error) {
    // Fallo al cerrar (p. ej. la base de datos): el run queda en error, no colgado.
    const message = error instanceof Error ? error.message : "Error al cerrar el run";
    push({ type: EventType.RUN_ERROR, message } as AgUiEvent);
    await drain();
    await deps.finishRun(runId, { kind: "error" }, { error: message, lastSeq: seq }).catch(() => {});
  } finally {
    clearInterval(heartbeat);
    if (writeError) {
      console.error("[nexus] el run terminó con errores de persistencia:", writeError);
    }
  }
}
