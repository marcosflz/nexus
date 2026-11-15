declare global {
  // eslint-disable-next-line no-var
  var __nexusActiveRuns: Map<string, AbortController> | undefined;
}

/** Runs que este proceso está ejecutando ahora mismo. */
const active: Map<string, AbortController> = (globalThis.__nexusActiveRuns ??= new Map());

export function registerRun(runId: string, controller: AbortController): void {
  active.set(runId, controller);
}

export function unregisterRun(runId: string): void {
  active.delete(runId);
}

export function isRunActive(runId: string): boolean {
  return active.has(runId);
}

/** Pide la cancelación de un run en curso. Devuelve false si este proceso no lo tiene. */
export function cancelRun(runId: string): boolean {
  const controller = active.get(runId);
  if (!controller) return false;
  controller.abort();
  return true;
}

/** Runs en ejecución en este proceso (para limitar la concurrencia). */
export function activeRunCount(): number {
  return active.size;
}
