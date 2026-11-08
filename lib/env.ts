/**
 * Lectura de variables de entorno con alias heredados.
 *
 * El proyecto se llamaba Plexo: las variables `PLEXO_*` siguen funcionando
 * durante una versión, con un aviso único por variable para que se migren.
 */
const warned = new Set<string>();

export function readEnv(name: string, legacy?: string): string | undefined {
  const current = process.env[name];
  if (current !== undefined && current.trim() !== "") return current;

  if (legacy) {
    const old = process.env[legacy];
    if (old !== undefined && old.trim() !== "") {
      if (!warned.has(legacy)) {
        warned.add(legacy);
        console.warn(`[nexus] ${legacy} está obsoleta: usa ${name}.`);
      }
      return old;
    }
  }
  return undefined;
}

export function readFlag(name: string, legacy: string | undefined, fallback: boolean): boolean {
  const raw = readEnv(name, legacy);
  if (raw === undefined) return fallback;
  return /^(1|true|on|yes|si|sí)$/i.test(raw.trim());
}

/** Solo para tests: olvida los avisos ya emitidos. */
export function resetEnvWarnings(): void {
  warned.clear();
}
