import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";
import { followRun, parseSseFrame, readSse, RunHttpError } from "./client";

const frame = (seq: number, event: object) => `id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`;

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { "Content-Type": "text/event-stream" } });
}

const started = { type: EventType.RUN_STARTED, threadId: "t", runId: "r1" };
const text = (delta: string) => ({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: "m", delta });
const finished = { type: EventType.RUN_FINISHED, threadId: "t", runId: "r1" };

describe("parseSseFrame", () => {
  it("lee id y evento", () => {
    expect(parseSseFrame(`id: 4\ndata: ${JSON.stringify(text("a"))}`)).toMatchObject({
      id: 4,
      event: { type: EventType.TEXT_MESSAGE_CONTENT, delta: "a" },
    });
  });

  it("ignora comentarios, frames vacíos y JSON roto", () => {
    expect(parseSseFrame(": ping")).toBeNull();
    expect(parseSseFrame("")).toBeNull();
    expect(parseSseFrame("id: 1\ndata: {no es json")).toBeNull();
  });
});

describe("readSse", () => {
  it("reconstruye frames partidos entre chunks", async () => {
    const raw = frame(1, started) + frame(2, text("hola"));
    const cut = Math.floor(raw.length / 2);
    const out: number[] = [];
    for await (const item of readSse(sseResponse([raw.slice(0, cut), raw.slice(cut)]).body!)) {
      out.push(item.id ?? -1);
    }
    expect(out).toEqual([1, 2]);
  });
});

describe("followRun", () => {
  const baseOptions = { retryDelayMs: 0 };

  it("sigue la respuesta inicial hasta el evento terminal", async () => {
    const seen: string[] = [];
    const result = await followRun({
      ...baseOptions,
      initial: sseResponse([frame(1, started), frame(2, text("a")), frame(3, finished)]),
      fetchEvents: async () => {
        throw new Error("no debería reconectar");
      },
      onEvent: (event) => seen.push(event.type as string),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ runId: "r1", terminal: true });
    expect(seen).toEqual([EventType.RUN_STARTED, EventType.TEXT_MESSAGE_CONTENT, EventType.RUN_FINISHED]);
  });

  it("reconecta con after=<último seq> si el stream se corta y no duplica", async () => {
    const requested: number[] = [];
    const seen: number[] = [];
    const result = await followRun({
      ...baseOptions,
      initial: sseResponse([frame(1, started), frame(2, text("a"))]), // se corta sin terminal
      fetchEvents: async (_runId, after) => {
        requested.push(after);
        // El servidor reenvía también el 2 (ya visto) por si acaso.
        return sseResponse([frame(2, text("a")), frame(3, text("b")), frame(4, finished)]);
      },
      onEvent: (_event, seq) => seen.push(seq ?? -1),
      signal: new AbortController().signal,
    });

    expect(requested).toEqual([2]);
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(result.terminal).toBe(true);
  });

  it("se engancha a un run existente desde un seq", async () => {
    const requested: number[] = [];
    await followRun({
      ...baseOptions,
      runId: "r9",
      after: 5,
      fetchEvents: async (runId, after) => {
        requested.push(after);
        expect(runId).toBe("r9");
        return sseResponse([frame(6, finished)]);
      },
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(requested).toEqual([5]);
  });

  it("no reintenta errores 4xx", async () => {
    await expect(
      followRun({
        ...baseOptions,
        runId: "r1",
        fetchEvents: async () => new Response("{}", { status: 404 }),
        onEvent: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(RunHttpError);
  });

  it("falla tras agotar los reintentos", async () => {
    let calls = 0;
    await expect(
      followRun({
        ...baseOptions,
        maxRetries: 2,
        initial: sseResponse([frame(1, started)]),
        fetchEvents: async () => {
          calls += 1;
          return sseResponse([]); // siempre vacío: nunca llega el terminal
        },
        onEvent: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Se perdió la conexión");
    expect(calls).toBe(2);
  });

  it("falla sin reintentar si la conexión cae antes de RUN_STARTED", async () => {
    await expect(
      followRun({
        ...baseOptions,
        initial: sseResponse([]),
        fetchEvents: async () => sseResponse([]),
        onEvent: () => {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("antes de iniciar");
  });

  it("devuelve terminal=false si se aborta desde fuera", async () => {
    const controller = new AbortController();
    const result = await followRun({
      ...baseOptions,
      initial: sseResponse([frame(1, started)]),
      fetchEvents: async () => sseResponse([]),
      onEvent: () => controller.abort(),
      signal: controller.signal,
    });
    expect(result.terminal).toBe(false);
  });
});

describe("followRun con pausas", () => {
  const interruptFinish = {
    type: EventType.RUN_FINISHED,
    threadId: "t",
    runId: "r1",
    outcome: { type: "interrupt", interrupts: [{ id: "i1", reason: "openui_form", toolCallId: "c1" }] },
  };

  it("una pausa termina el seguimiento como pausado, sin reconectar", async () => {
    let reconnects = 0;
    const result = await followRun({
      retryDelayMs: 0,
      initial: sseResponse([frame(1, started), frame(2, interruptFinish)]),
      fetchEvents: async () => {
        reconnects += 1;
        return sseResponse([]);
      },
      onEvent: () => {},
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ runId: "r1", terminal: true, paused: true });
    expect(reconnects).toBe(0);
  });

  it("no se queda en una pausa superada: sigue hasta el final del run reanudado", async () => {
    const seen: number[] = [];
    const result = await followRun({
      retryDelayMs: 0,
      initial: sseResponse([
        frame(1, started),
        frame(2, interruptFinish),
        frame(3, started),
        frame(4, text("Listo")),
        frame(5, finished),
      ]),
      fetchEvents: async () => sseResponse([]),
      onEvent: (_event, seq) => seen.push(seq ?? -1),
      signal: new AbortController().signal,
    });

    expect(seen).toEqual([1, 2, 3, 4, 5]);
    expect(result).toEqual({ runId: "r1", terminal: true });
  });
});
