import type { AgentBackend, BackendRunInput } from "@/lib/agents/backend";
import { defaultExecutorDeps } from "./deps";
import { executeRun, type ExecuteRunInput, type ExecutorDeps } from "./executor";
import { registerRun, unregisterRun } from "./registry";

/**
 * Lanza un run en segundo plano y devuelve de inmediato.
 *
 * El run **no** depende de la petición que lo creó: cerrar la pestaña no lo
 * aborta. Para pararlo hay que llamar a `cancelRun`.
 */
export function startRun(
  backend: AgentBackend,
  input: BackendRunInput,
  deps: ExecutorDeps = defaultExecutorDeps(),
  seed?: ExecuteRunInput["seed"],
): Promise<void> {
  const controller = new AbortController();
  registerRun(input.runId, controller);

  return executeRun(deps, { backend, input, seed }, controller.signal)
    .catch((error) => console.error("[nexus] el ejecutor de runs falló:", error))
    .finally(() => unregisterRun(input.runId));
}
