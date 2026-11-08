import type { AgUiEvent } from "@/lib/agui/events";
import { RunBus } from "./bus";
import type { ExecutorDeps } from "./executor";
import type { NewRunEvent } from "./store";
import type { TailDeps } from "./tail";
import type { RunStatus } from "./types";

/** Almacenamiento en memoria para probar el ejecutor y el tail sin Postgres. */
export function createMemoryRunStore() {
  const bus = new RunBus();
  const events: NewRunEvent[] = [];
  const calls = {
    finish: [] as { runId: string; transition: unknown; options: unknown }[],
    savedMessages: [] as Record<string, unknown>[],
    heartbeats: [] as number[],
  };
  let status: RunStatus = "running";
  /** Eventos que existían en la «base de datos» en el momento de cada publicación. */
  const persistedAtPublish: number[] = [];

  bus.subscribe("run-1", (message) => {
    persistedAtPublish.push(events.filter((event) => event.seq === message.seq).length);
  });

  const executorDeps: ExecutorDeps = {
    bus,
    flushMs: 5,
    heartbeatMs: 10_000,
    async appendEvents(_runId, batch) {
      events.push(...batch);
    },
    async heartbeat(_runId, lastSeq) {
      calls.heartbeats.push(lastSeq);
    },
    async finishRun(runId, transition, options) {
      calls.finish.push({ runId, transition, options });
      status =
        transition.kind === "finished"
          ? "completed"
          : transition.kind === "awaiting-input"
            ? "awaiting_input"
            : transition.kind === "cancelled"
              ? "cancelled"
              : "error";
      return status;
    },
    async saveAssistantMessage(message) {
      calls.savedMessages.push(message as unknown as Record<string, unknown>);
      return "message-1";
    },
  };

  const tailDeps: TailDeps = {
    bus,
    keepaliveMs: 60_000,
    async getEventsAfter(_runId, after) {
      return events.filter((event) => event.seq > after);
    },
    async getStatus() {
      return { status, leaseUntil: null };
    },
    isActive: () => false,
  };

  return {
    bus,
    events,
    calls,
    persistedAtPublish,
    executorDeps,
    tailDeps,
    setStatus(next: RunStatus) {
      status = next;
    },
    types: () => events.map((event) => (event.payload as AgUiEvent).type as string),
  };
}

/** Lee un ReadableStream SSE completo y devuelve sus frames ya interpretados. */
export async function readSseFrames(
  stream: ReadableStream<Uint8Array>,
): Promise<{ id: number | null; event: AgUiEvent | null; comment: boolean }[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  return buffer
    .split("\n\n")
    .filter((frame) => frame.trim() !== "")
    .map((frame) => {
      if (frame.startsWith(":")) return { id: null, event: null, comment: true };
      const id = /^id: (\d+)/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      return {
        id: id ? Number(id) : null,
        event: data ? (JSON.parse(data) as AgUiEvent) : null,
        comment: false,
      };
    });
}
