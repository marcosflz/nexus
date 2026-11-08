import type { TriggerRow } from "./service";

/** Lo que se muestra de un disparador: nunca el hash del token del webhook. */
export function publicTrigger(row: TriggerRow) {
  const { tokenHash: _tokenHash, ...config } = row.config as Record<string, unknown>;
  void _tokenHash;
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    prompt: row.prompt,
    config,
    enabled: row.enabled,
    nextRunAt: row.nextRunAt,
    lastRunAt: row.lastRunAt,
    failureCount: row.failureCount,
  };
}

