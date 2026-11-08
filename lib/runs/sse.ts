import { getEventsAfter, getRunMeta, reclaimExpiredRuns } from "./store";
import { isRunActive } from "./registry";
import { runBus } from "./bus";
import { tailRun, type TailDeps } from "./tail";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
} as const;

/** Dependencias reales del tail: Postgres + bus + registro de runs activos. */
export function defaultTailDeps(userId: string): TailDeps {
  return {
    bus: runBus,
    getEventsAfter: (runId, after) => getEventsAfter(runId, after),
    getStatus: async (runId) => {
      const run = await getRunMeta(runId, userId);
      return run ? { status: run.status, leaseUntil: run.leaseUntil } : null;
    },
    isActive: isRunActive,
    onOrphan: async () => {
      await reclaimExpiredRuns();
    },
  };
}

export function sseResponse(
  runId: string,
  userId: string,
  after: number,
  signal?: AbortSignal,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(tailRun(defaultTailDeps(userId), { runId, after, signal }), {
    headers: { ...SSE_HEADERS, ...extraHeaders },
  });
}
