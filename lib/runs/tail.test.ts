import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import type { AgUiEvent } from "@/lib/agui/events";
import { createMemoryRunStore, readSseFrames } from "./testing";
import { tailRun } from "./tail";

const ev = (type: string, extra: Record<string, unknown> = {}) =>
  ({ type, ...extra }) as unknown as AgUiEvent;

describe("tailRun", () => {
  it("entrega el backlog y termina en el evento terminal", async () => {
    const store = createMemoryRunStore();
    store.events.push(
      { seq: 1, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED, { runId: "run-1" }) },
      { seq: 2, type: "TEXT_MESSAGE_CONTENT", payload: ev(EventType.TEXT_MESSAGE_CONTENT, { delta: "a" }) },
      { seq: 3, type: "RUN_FINISHED", payload: ev(EventType.RUN_FINISHED, { runId: "run-1" }) },
    );

    const frames = await readSseFrames(tailRun(store.tailDeps, { runId: "run-1", after: 0 }));

    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3]);
  });

  it("respeta `after` y no repite lo ya entregado", async () => {
    const store = createMemoryRunStore();
    store.events.push(
      { seq: 1, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED) },
      { seq: 2, type: "TEXT_MESSAGE_CONTENT", payload: ev(EventType.TEXT_MESSAGE_CONTENT, { delta: "a" }) },
      { seq: 3, type: "RUN_FINISHED", payload: ev(EventType.RUN_FINISHED) },
    );

    const frames = await readSseFrames(tailRun(store.tailDeps, { runId: "run-1", after: 2 }));

    expect(frames.map((frame) => frame.id)).toEqual([3]);
  });

  it("empalma backlog y directo sin huecos ni duplicados", async () => {
    const store = createMemoryRunStore();
    // Backlog: 1-2. El evento 2 además se publica en vivo (duplicado), y luego 3-4.
    store.events.push(
      { seq: 1, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED) },
      { seq: 2, type: "TEXT_MESSAGE_CONTENT", payload: ev(EventType.TEXT_MESSAGE_CONTENT, { delta: "a" }) },
    );
    store.setStatus("running");
    // Mientras el run está vivo en este proceso no se considera huérfano.
    const deps = { ...store.tailDeps, isActive: () => true };

    const stream = tailRun(deps, { runId: "run-1", after: 0 });
    const framesPromise = readSseFrames(stream);

    // Publica tras suscribirse: 2 repetido, 3 y el terminal 4 (desordenado a propósito).
    await new Promise((resolve) => setTimeout(resolve, 10));
    store.bus.publish("run-1", { seq: 2, event: ev(EventType.TEXT_MESSAGE_CONTENT, { delta: "a" }) });
    store.bus.publish("run-1", { seq: 3, event: ev(EventType.TEXT_MESSAGE_CONTENT, { delta: "b" }) });
    store.bus.publish("run-1", { seq: 4, event: ev(EventType.RUN_FINISHED) });

    const frames = await framesPromise;
    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4]);
  });

  it("cierra con un RUN_ERROR sintético si el run murió sin evento terminal", async () => {
    const store = createMemoryRunStore();
    store.events.push({ seq: 1, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED) });
    store.setStatus("interrupted");

    const frames = await readSseFrames(tailRun(store.tailDeps, { runId: "run-1", after: 0 }));

    expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
    expect(frames[1].event).toMatchObject({ type: EventType.RUN_ERROR, code: "interrupted" });
  });

  it("avisa de que el run está huérfano para que se cierre su estado", async () => {
    const store = createMemoryRunStore();
    store.setStatus("interrupted");
    const orphans: string[] = [];

    await readSseFrames(
      tailRun({ ...store.tailDeps, onOrphan: (runId) => void orphans.push(runId) }, { runId: "run-1", after: 0 }),
    );

    expect(orphans).toEqual(["run-1"]);
  });

  it("no inventa un error si el evento terminal llegó justo al cerrar", async () => {
    const store = createMemoryRunStore();
    store.events.push({ seq: 1, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED) });
    // La primera lectura no ve el terminal (aún no persistido)…
    let reads = 0;
    const racing = {
      ...store.tailDeps,
      async getEventsAfter(runId: string, after: number) {
        reads += 1;
        if (reads === 2) {
          store.events.push({ seq: 2, type: "RUN_FINISHED", payload: ev(EventType.RUN_FINISHED) });
        }
        return store.tailDeps.getEventsAfter(runId, after);
      },
    };
    // …pero el estado ya consta como cerrado.
    store.setStatus("completed");
    // Primera lectura (backlog) devuelve solo el 1; la releja de huérfano encuentra el 2.
    const frames = await readSseFrames(tailRun(racing, { runId: "run-1", after: 0 }));

    expect(frames.map((frame) => frame.event?.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  });
});

describe("tailRun con runs pausados", () => {
  const interruptFinish = ev(EventType.RUN_FINISHED, { outcome: { type: "interrupt", interrupts: [] } });

  it("cierra en una pausa si es lo último que hay", async () => {
    const store = createMemoryRunStore();
    store.events.push(
      { seq: 1, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED) },
      { seq: 2, type: "RUN_FINISHED", payload: interruptFinish },
    );
    store.setStatus("awaiting_input");

    const frames = await readSseFrames(tailRun(store.tailDeps, { runId: "run-1", after: 0 }));

    expect(frames.map((frame) => frame.id)).toEqual([1, 2]);
  });

  it("sigue más allá de una pausa ya superada hasta el final real", async () => {
    const store = createMemoryRunStore();
    store.events.push(
      { seq: 1, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED) },
      { seq: 2, type: "RUN_FINISHED", payload: interruptFinish }, // pausa…
      { seq: 3, type: "RUN_STARTED", payload: ev(EventType.RUN_STARTED) }, // …reanudada
      { seq: 4, type: "TEXT_MESSAGE_CONTENT", payload: ev(EventType.TEXT_MESSAGE_CONTENT, { delta: "a" }) },
      { seq: 5, type: "RUN_FINISHED", payload: ev(EventType.RUN_FINISHED, { outcome: { type: "success" } }) },
    );
    store.setStatus("completed");

    const frames = await readSseFrames(tailRun(store.tailDeps, { runId: "run-1", after: 0 }));

    expect(frames.map((frame) => frame.id)).toEqual([1, 2, 3, 4, 5]);
  });
});
