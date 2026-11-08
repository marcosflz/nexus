// Renombra los perfiles y workspaces de Hermes de `plexo-<hash>` a `nexus-<hash>`.
//
// Es idempotente y no destructivo: si el destino ya existe no toca nada, y si
// algo falla lo registra y sigue (la app tiene un fallback al nombre antiguo,
// ver `resolveProfileName` en lib/hermes/profiles.ts).
import { access, readdir, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OLD_PREFIX = "plexo-";
const NEW_PREFIX = "nexus-";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function listDir(dir) {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/**
 * @param {string} home HERMES_HOME
 * @returns {Promise<{ renamed: string[], skipped: string[], failed: string[] }>}
 */
export async function migrateProfiles(home) {
  const result = { renamed: [], skipped: [], failed: [] };

  for (const group of ["profiles", "workspaces"]) {
    const base = path.join(home, group);
    for (const entry of await listDir(base)) {
      if (!entry.startsWith(OLD_PREFIX)) continue;
      const target = NEW_PREFIX + entry.slice(OLD_PREFIX.length);
      const from = path.join(base, entry);
      const to = path.join(base, target);
      const label = `${group}/${entry} -> ${target}`;

      if (await exists(to)) {
        result.skipped.push(label);
        continue;
      }
      try {
        await rename(from, to);
        result.renamed.push(label);
      } catch (error) {
        result.failed.push(`${label}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  return result;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const home = process.env.HERMES_HOME ?? path.join(process.cwd(), ".hermes-data");
  const { renamed, skipped, failed } = await migrateProfiles(home);
  for (const item of renamed) console.log(`[nexus] perfil migrado: ${item}`);
  for (const item of skipped) console.log(`[nexus] perfil omitido (el destino ya existe): ${item}`);
  for (const item of failed) console.warn(`[nexus] no se pudo migrar: ${item}`);
}
