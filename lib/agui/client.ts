import { EventType } from "@ag-ui/core";
import type { AgUiEvent } from "./events";

export interface SseFrame {
  /** `seq` del evento (cabecera `id:`), o null si el frame no lo lleva. */
  id: number | null;
  event: AgUiEvent;
}

/** Interpreta un frame SSE. Los comentarios (`: ping`) y los frames rotos dan null. */
export function parseSseFrame(frame: string): SseFrame | null {
  let id: number | null = null;
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("id:")) {
      const parsed = Number.parseInt(line.slice(3).trim(), 10);
      if (Number.isFinite(parsed)) id = parsed;
    } else if (line.startsWith("data:")) {
      data += line.slice(5).trim();
    }
  }
  if (!data) return null;
  try {
    const event = JSON.parse(data) as AgUiEvent;
    return typeof event?.type === "string" ? { id, event } : null;
  } catch {
    return null;
  }
}

/** Lee un cuerpo SSE y emite los frames AG-UI a medida que llegan. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const parsed = parseSseFrame(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (parsed) yield parsed;
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function isTerminalAgUiEvent(event: AgUiEvent): boolean {
  return event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR;
}

/** Fin de una pausa: el run espera a la persona y se reanuda en la misma fila. */
export function isInterruptFinish(event: AgUiEvent): boolean {
  if (event.type !== EventType.RUN_FINISHED) return false;
  return (event as { outcome?: { type?: string } }).outcome?.type === "interrupt";
}

/** Error HTTP que no tiene sentido reintentar (401, 404…). */
export class RunHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface FollowRunOptions {
  /** Respuesta del `POST /api/chat`, ya abierta. Si falta, hay que dar `runId`. */
  initial?: Response;
  /** Run al que engancharse (recarga a mitad de turno). */
  runId?: string;
  /** Último `seq` ya recibido. */
  after?: number;
  fetchEvents: (runId: string, after: number, signal: AbortSignal) => Promise<Response>;
  onEvent: (event: AgUiEvent, seq: number | null) => void;
  signal: AbortSignal;
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface FollowRunResult {
  runId: string | null;
  /** Se vio `RUN_FINISHED` o `RUN_ERROR`. False si se abortó desde fuera. */
  terminal: boolean;
  /** El run terminó pausado, esperando una respuesta (formulario, aprobación). */
  paused?: boolean;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * Sigue un run hasta su evento terminal.
 *
 * Si la conexión se corta antes (red, proxy, reinicio), se vuelve a abrir
 * `GET /api/runs/:id/events?after=<último seq>` y se continúa sin duplicar
 * nada: el servidor reenvía desde el backlog guardado.
 */
export async function followRun(options: FollowRunOptions): Promise<FollowRunResult> {
  const { fetchEvents, onEvent, signal, maxRetries = 5, retryDelayMs = 1000 } = options;
  let runId = options.runId ?? null;
  let lastSeq = options.after ?? 0;
  let response: Response | null = options.initial ?? null;
  let retries = 0;

  while (!signal.aborted) {
    try {
      if (!response) {
        if (!runId) throw new Error("La conexión se cerró antes de iniciar el turno");
        response = await fetchEvents(runId, lastSeq, signal);
      }
      if (!response.ok || !response.body) {
        const clientError = response.status >= 400 && response.status < 500;
        if (clientError) throw new RunHttpError(response.status, `Error del servidor (${response.status})`);
        throw new Error(`Error del servidor (${response.status})`);
      }

      let paused = false;
      for await (const frame of readSse(response.body)) {
        retries = 0;
        if (frame.id !== null) {
          if (frame.id <= lastSeq) continue;
          lastSeq = frame.id;
        }
        if (frame.event.type === EventType.RUN_STARTED) {
          runId = (frame.event as { runId: string }).runId;
        }
        onEvent(frame.event, frame.id);
        // Una pausa no cierra el seguimiento por sí sola: en un log reanudado
        // puede haber más eventos detrás. Se decide al acabar el stream.
        paused = isInterruptFinish(frame.event);
        if (isTerminalAgUiEvent(frame.event) && !paused) return { runId, terminal: true };
      }
      if (paused) return { runId, terminal: true, paused: true };
    } catch (error) {
      if (signal.aborted) break;
      if (error instanceof RunHttpError) throw error;
      if (!runId) throw error;
    }

    // El stream terminó sin evento terminal: reconectar desde lastSeq.
    response = null;
    if (signal.aborted) break;
    if (!runId) throw new Error("La conexión se cerró antes de iniciar el turno");
    retries += 1;
    if (retries > maxRetries) throw new Error("Se perdió la conexión con el servidor");
    await sleep(retryDelayMs * retries, signal);
  }

  return { runId, terminal: false };
}
