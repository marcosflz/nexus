import { reconcileBots } from "@/lib/bots/service";
import { reclaimExpiredRuns } from "@/lib/runs/store";
import { startWorker, type Worker } from "./loop";
import { retireAgentEnvironments } from "@/lib/runtime/retire";

declare global {
  // eslint-disable-next-line no-var
  var __nexusWorkerBooted: boolean | undefined;
  // eslint-disable-next-line no-var
  var __nexusWorker: Worker | undefined;
}

/**
 * Arranque del proceso: reconcilia los runs que quedaron `running` cuando el
 * servidor anterior murió. No espera a la base de datos (no debe retrasar el
 * arranque) y es idempotente frente al HMR de desarrollo.
 */
export function bootWorker(): void {
  if (globalThis.__nexusWorkerBooted) return;
  globalThis.__nexusWorkerBooted = true;
  void retireAgentEnvironments().catch((error) => console.warn("[nexus] retirada de entornos antiguos pendiente:", error));

  // El registro de runs de este proceso está vacío: todo `running` es de uno anterior.
  void reclaimExpiredRuns(new Date(), { ignoreLease: true })
    .then((count) => {
      if (count > 0) console.log(`[nexus] ${count} run(s) huérfano(s) marcados como interrumpidos`);
    })
    .catch((error) => {
      console.warn("[nexus] no se pudieron reconciliar los runs al arrancar:", error);
    });

  // Tras reiniciar el host, Docker no levanta los bots: se arrancan los que debían estar en marcha.
  void reconcileBots().catch((error) => {
    console.warn("[nexus] no se pudieron reconciliar los NexBots al arrancar:", error);
  });

  void import("@/lib/rooms/engine")
    .then(({ dispatchAllRooms }) => dispatchAllRooms())
    .catch((error) => console.warn("[nexus] no se pudieron reanudar las salas de NexBots:", error));

  // `NEXUS_WORKER=off` desactiva el planificador (p. ej. en una réplica solo de lectura).
  if (!/^(0|off|false|no)$/i.test(process.env.NEXUS_WORKER ?? "")) {
    globalThis.__nexusWorker = startWorker();
  }
}
