/**
 * Feature flags de Plexo.
 *
 * Se leen del entorno en cada llamada (sin cachear) para que cambiar el
 * `docker-compose.yml` o el `.env` no obligue a reconstruir la imagen.
 */

function readFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return /^(1|true|on|yes|si|sí)$/i.test(raw.trim());
}

/** Intelligent UI (OpenUI). Si está apagado, el prompt no incluye la librería. */
export function openuiEnabled(): boolean {
  return readFlag("PLEXO_OPENUI", true);
}

/** Toolset `browser` de Hermes + servicio Chromium. Apagado por defecto. */
export function computerEnabled(): boolean {
  return readFlag("PLEXO_COMPUTER", false);
}

/** Policy gateway y tarjetas de aprobación. */
export function approvalsEnabled(): boolean {
  return readFlag("PLEXO_APPROVALS", true);
}
