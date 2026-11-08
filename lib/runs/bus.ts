import type { AgUiEvent } from "@/lib/agui/events";

export interface BusMessage {
  seq: number;
  event: AgUiEvent;
}

type Listener = (message: BusMessage) => void;

/**
 * Bus en proceso de los eventos de un run.
 *
 * Contrato: el ejecutor **persiste y luego publica**. Quien se suscribe lee
 * después el backlog de la base de datos y deduplica por `seq`, de modo que no
 * hay hueco ni duplicado entre «ya guardado» y «en vivo».
 *
 * Es de un solo proceso. Con varias instancias habría que sustituirlo por
 * LISTEN/NOTIFY de Postgres manteniendo esta misma interfaz.
 */
export class RunBus {
  private readonly listeners = new Map<string, Set<Listener>>();

  subscribe(runId: string, listener: Listener): () => void {
    let set = this.listeners.get(runId);
    if (!set) {
      set = new Set();
      this.listeners.set(runId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(runId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(runId);
    };
  }

  publish(runId: string, message: BusMessage): void {
    const set = this.listeners.get(runId);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(message);
      } catch (error) {
        console.warn("[nexus] un suscriptor del bus de runs falló:", error);
      }
    }
  }

  listenerCount(runId: string): number {
    return this.listeners.get(runId)?.size ?? 0;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __nexusRunBus: RunBus | undefined;
}

/** Singleton que sobrevive al HMR de desarrollo. */
export const runBus: RunBus = (globalThis.__nexusRunBus ??= new RunBus());
