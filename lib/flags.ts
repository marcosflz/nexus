/**
 * Feature flags de Nexus.
 *
 * Se leen del entorno en cada llamada (sin cachear) para que cambiar el
 * `docker-compose.yml` o el `.env` no obligue a reconstruir la imagen.
 * Las variables `PLEXO_*` siguen valiendo como alias heredado (ver `lib/env.ts`).
 */
import { readFlag } from "@/lib/env";

/** Intelligent UI (OpenUI). Si está apagado, el prompt no incluye la librería. */
export function openuiEnabled(): boolean {
  return readFlag("NEXUS_OPENUI", "PLEXO_OPENUI", true);
}

/** Policy gateway y tarjetas de aprobación. */
export function approvalsEnabled(): boolean {
  return readFlag("NEXUS_APPROVALS", "PLEXO_APPROVALS", true);
}
