import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import type { AgentBackend, BackendRunInput, BackendRunResult } from "@/lib/agents/backend";
import { NEXUS_SESSION, type AgUiEvent } from "@/lib/agui/events";
import { executeRun } from "./executor";
import { createMemoryRunStore } from "./testing";

const INPUT: BackendRunInput = {
  runId: "run-1",
  threadId: "thread-1",
  userId: "user-1",
  initiator: "user",
  credential: { provider: "openrouter", model: "m", apiKey: "k", baseUrl: null },
  userText: "hola",
};

function fakeBackend(
  script: (emit: (event: AgUiEvent) => void, signal: AbortSignal) => Promise<Partial<BackendRunResult>>,
): AgentBackend {
  return {
    id: "hermes",
    capabilities: { appTools: false, toolArgStreaming: false, interrupts: false, preToolPolicy: false },
    async run(_input, emit, signal) {
      const partial = await script(emit, signal);
      return {
        backendSessionId: null,
        outcome: "success",
        finalText: "",
        sources: [],
        ...partial,
      };
    },
  };
}

const text = (delta: string) =>
  ({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m1", delta }) as AgUiEvent;

describe("executeRun", () => {
  it("numera, persiste y cierra un turno correcto", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async (emit) => {
      emit({ type: EventType.TEXT_MESSAGE_START, messageId: "m1", role: "assistant" } as AgUiEvent);
      emit(text("Hola "));
      emit(text("mundo"));
      emit({ type: EventType.TOOL_CALL_START, toolCallId: "c1", toolCallName: "web_search" } as AgUiEvent);
      emit({ type: EventType.TOOL_CALL_END, toolCallId: "c1" } as AgUiEvent);
      return { finalText: "Hola mundo", usage: { input: 3, output: 2, total: 5 } };
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    const types = store.types();
    expect(types[0]).toBe(EventType.RUN_STARTED);
    expect(types.at(-1)).toBe(EventType.RUN_FINISHED);
    expect(types).toContain("CUSTOM"); // nexus.message
    // seq contiguo desde 1
    expect(store.events.map((event) => event.seq)).toEqual(
      store.events.map((_, index) => index + 1),
    );
    // Los dos deltas seguidos se agrupan en un solo evento.
    const contents = store.events.filter(
      (event) => (event.payload as AgUiEvent).type === EventType.TEXT_MESSAGE_CONTENT,
    );
    expect(contents).toHaveLength(1);
    expect((contents[0].payload as { delta: string }).delta).toBe("Hola mundo");

    expect(store.calls.savedMessages).toHaveLength(1);
    expect(store.calls.savedMessages[0]).toMatchObject({ content: "Hola mundo", threadId: "thread-1" });
    expect(store.calls.finish).toHaveLength(1);
    expect(store.calls.finish[0]).toMatchObject({
      transition: { kind: "finished" },
      options: { lastSeq: store.events.length },
    });
  });

  it("persiste cada evento antes de publicarlo en el bus", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async (emit) => {
      emit(text("a"));
      return { finalText: "a" };
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    expect(store.persistedAtPublish.length).toBe(store.events.length);
    expect(store.persistedAtPublish.every((count) => count === 1)).toBe(true);
  });

  it("un fallo del motor deja RUN_ERROR y no guarda mensaje", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async () => {
      throw new Error("sin crédito");
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    expect(store.types().at(-1)).toBe(EventType.RUN_ERROR);
    expect((store.events.at(-1)?.payload as { message: string }).message).toBe("sin crédito");
    expect(store.calls.savedMessages).toHaveLength(0);
    expect(store.calls.finish[0]).toMatchObject({ transition: { kind: "error" } });
  });

  it("la cancelación se registra como cancelled, no como error", async () => {
    const store = createMemoryRunStore();
    const controller = new AbortController();
    const backend = fakeBackend(async (_emit, signal) => {
      controller.abort();
      expect(signal.aborted).toBe(true);
      throw new Error("turno cancelado");
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, controller.signal);

    const last = store.events.at(-1)?.payload as { type: string; code?: string; message: string };
    expect(last.type).toBe(EventType.RUN_ERROR);
    expect(last.code).toBe("cancelled");
    expect(store.calls.finish[0]).toMatchObject({ transition: { kind: "cancelled" } });
  });

  it("una interrupción deja el run en awaiting_input sin guardar mensaje", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async () => ({
      outcome: "interrupt",
      interrupts: [{ id: "i1", reason: "aprobar browser_click" }],
    }));

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    const last = store.events.at(-1)?.payload as { type: string; outcome: { type: string } };
    expect(last.type).toBe(EventType.RUN_FINISHED);
    expect(last.outcome.type).toBe("interrupt");
    expect(store.calls.savedMessages).toHaveLength(0);
    expect(store.calls.finish[0]).toMatchObject({ transition: { kind: "awaiting-input" } });
  });

  it("guarda la sesión del motor en cuanto llega, sin esperar al final", async () => {
    const store = createMemoryRunStore();
    let sessionSavedBeforeEnd = false;
    const backend = fakeBackend(async (emit) => {
      emit({ type: EventType.CUSTOM, name: NEXUS_SESSION, value: { sessionId: "sess-9" } } as AgUiEvent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      sessionSavedBeforeEnd = store.calls.threadSessions.includes("sess-9");
      throw new Error("el turno falla después");
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    expect(sessionSavedBeforeEnd).toBe(true);
    expect(store.calls.agentSessions).toEqual(["sess-9"]);
  });

  it("no reescribe la sesión si es la misma que ya tenía el hilo", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async (emit) => {
      emit({ type: EventType.CUSTOM, name: NEXUS_SESSION, value: { sessionId: "sess-1" } } as AgUiEvent);
      return { finalText: "ok" };
    });

    await executeRun(
      store.executorDeps,
      { backend, input: { ...INPUT, backendSessionId: "sess-1" } },
      new AbortController().signal,
    );

    expect(store.calls.threadSessions).toEqual([]);
  });
});

describe("executeRun: pausa y reanudación", () => {
  const toolEvents = (id: string, name: string, args: string) =>
    [
      { type: EventType.TOOL_CALL_START, toolCallId: id, toolCallName: name },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: args },
      { type: EventType.TOOL_CALL_END, toolCallId: id },
    ] as AgUiEvent[];

  it("guarda el checkpoint al pausar y no persiste todavía el mensaje", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async (emit) => {
      for (const event of toolEvents("c1", "prompt_openui", '{"ui":"root = Form([])"}')) emit(event);
      return {
        outcome: "interrupt",
        interrupts: [{ id: "i1", reason: "openui_form", toolCallId: "c1" }],
        checkpoint: [{ role: "assistant", n: 1 }],
      };
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    expect(store.calls.savedMessages).toHaveLength(0);
    expect(store.calls.finish[0]).toMatchObject({
      transition: { kind: "awaiting-input" },
      options: { checkpoint: [{ role: "assistant", n: 1 }] },
    });
  });

  it("al reanudar continúa el mismo log y el mensaje final incluye lo anterior a la pausa", async () => {
    const store = createMemoryRunStore();
    const first = fakeBackend(async (emit) => {
      emit(text("Antes. "));
      for (const event of toolEvents("c1", "prompt_openui", '{"ui":"root = Form([])"}')) emit(event);
      return {
        outcome: "interrupt",
        interrupts: [{ id: "i1", reason: "openui_form", toolCallId: "c1" }],
        checkpoint: [],
      };
    });
    await executeRun(store.executorDeps, { backend: first, input: INPUT }, new AbortController().signal);
    const pausedEvents = store.events.map((e) => e.payload as AgUiEvent);
    const pausedSeq = store.events.length;

    const second = fakeBackend(async (emit) => {
      emit({
        type: EventType.TOOL_CALL_RESULT,
        messageId: "r",
        toolCallId: "c1",
        content: '{"destino":"Lisboa"}',
        role: "tool",
      } as unknown as AgUiEvent);
      emit(text("Listo."));
      return { finalText: "Listo.", contentSource: "stream", followups: ["¿Y el hotel?"] };
    });
    await executeRun(
      store.executorDeps,
      {
        backend: second,
        input: { ...INPUT, resume: [{ callId: "c1", status: "resolved", payload: { destino: "Lisboa" } }] },
        seed: { events: pausedEvents, lastSeq: pausedSeq },
      },
      new AbortController().signal,
    );

    // El log sigue contiguo y vuelve a anunciar el inicio del run.
    expect(store.events.map((e) => e.seq)).toEqual(store.events.map((_, i) => i + 1));
    const starts = store.types().filter((type) => type === EventType.RUN_STARTED);
    expect(starts).toHaveLength(2);
    expect(store.events[pausedSeq].seq).toBe(pausedSeq + 1);

    const saved = store.calls.savedMessages[0] as {
      content: string;
      tools: { id: string; result?: string; status: string }[];
      followups: string[];
    };
    expect(saved.content).toBe("Antes. Listo.");
    expect(saved.tools.find((tool) => tool.id === "c1")).toMatchObject({
      status: "complete",
      result: '{"destino":"Lisboa"}',
    });
    expect(saved.followups).toEqual(["¿Y el hotel?"]);
    expect(store.calls.finish.at(-1)).toMatchObject({ transition: { kind: "finished" } });
  });

  it("con contentSource=stream el texto guardado es el que vio la persona, no el finalText", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async (emit) => {
      emit(text("Vista por la persona"));
      return { finalText: "Solo el último mensaje", contentSource: "stream" };
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    expect((store.calls.savedMessages[0] as { content: string }).content).toBe("Vista por la persona");
  });

  it("los follow-ups emitidos como evento tienen prioridad sobre los del resultado", async () => {
    const store = createMemoryRunStore();
    const backend = fakeBackend(async (emit) => {
      emit({ type: EventType.CUSTOM, name: "nexus.followups", value: { questions: ["Del evento"] } } as AgUiEvent);
      return { finalText: "x", followups: ["Del resultado"] };
    });

    await executeRun(store.executorDeps, { backend, input: INPUT }, new AbortController().signal);

    expect((store.calls.savedMessages[0] as { followups: string[] }).followups).toEqual(["Del evento"]);
  });
});
