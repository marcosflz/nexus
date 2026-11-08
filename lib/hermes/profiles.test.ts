import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateProfiles } from "../../scripts/migrate-hermes-profiles.mjs";
import {
  ensureProfile,
  isOutdatedManagedSoul,
  legacyProfileName,
  profileName,
  resolveProfileName,
  SOUL_VERSION,
} from "./profiles";

const USER_ID = "00000000-0000-0000-0000-0000000000aa";

describe("perfiles de Hermes", () => {
  let home = "";

  beforeEach(async () => {
    home = await mkdtemp(path.join(tmpdir(), "nexus-profiles-"));
    process.env.HERMES_HOME = home;
    // `hermes profile create` no debe lanzar nada real en los tests.
    process.env.HERMES_BIN = "/bin/true";
  });

  it("usa el prefijo nexus- y conserva el hash del usuario", () => {
    expect(profileName(USER_ID)).toBe("nexus-000000000000000" + "0");
    expect(legacyProfileName(USER_ID)).toBe(profileName(USER_ID).replace("nexus-", "plexo-"));
  });

  it("cae al perfil heredado si todavía no se ha migrado", async () => {
    await mkdir(path.join(home, "profiles", legacyProfileName(USER_ID)), { recursive: true });
    expect(await resolveProfileName(USER_ID)).toBe(legacyProfileName(USER_ID));
  });

  it("prefiere el perfil nuevo cuando existen los dos", async () => {
    await mkdir(path.join(home, "profiles", legacyProfileName(USER_ID)), { recursive: true });
    await mkdir(path.join(home, "profiles", profileName(USER_ID)), { recursive: true });
    expect(await resolveProfileName(USER_ID)).toBe(profileName(USER_ID));
  });

  it("crea el perfil nuevo con SOUL versionado", async () => {
    const name = await ensureProfile(USER_ID);
    const soul = await readFile(path.join(home, "profiles", name, "SOUL.md"), "utf8");
    expect(name).toBe(profileName(USER_ID));
    expect(soul).toContain(`nexus-soul v${SOUL_VERSION}`);
  });

  it("no pisa un SOUL editado por el usuario", async () => {
    const dir = path.join(home, "profiles", profileName(USER_ID));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SOUL.md"), "# Mi SOUL personalizado\n", "utf8");
    await ensureProfile(USER_ID);
    expect(await readFile(path.join(dir, "SOUL.md"), "utf8")).toBe("# Mi SOUL personalizado\n");
  });

  it("reescribe un SOUL gestionado de una versión anterior", async () => {
    const dir = path.join(home, "profiles", profileName(USER_ID));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "SOUL.md"), "<!-- nexus-soul v1 -->\nviejo\n", "utf8");
    await ensureProfile(USER_ID);
    const soul = await readFile(path.join(dir, "SOUL.md"), "utf8");
    expect(soul).toContain(`nexus-soul v${SOUL_VERSION}`);
  });

  it("isOutdatedManagedSoul distingue gestionado de editado", () => {
    expect(isOutdatedManagedSoul("<!-- nexus-soul v1 -->\nx")).toBe(true);
    expect(isOutdatedManagedSoul(`<!-- nexus-soul v${SOUL_VERSION} -->\nx`)).toBe(false);
    expect(isOutdatedManagedSoul("# Otra cosa")).toBe(false);
  });
});

describe("migrateProfiles", () => {
  it("renombra perfiles y workspaces y es idempotente", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "nexus-migrate-"));
    await mkdir(path.join(home, "profiles", "plexo-abc"), { recursive: true });
    await mkdir(path.join(home, "workspaces", "plexo-abc"), { recursive: true });
    await writeFile(path.join(home, "profiles", "plexo-abc", "state.db"), "datos");

    const first = await migrateProfiles(home);
    expect(first.renamed).toHaveLength(2);
    expect(first.failed).toHaveLength(0);
    expect(await readFile(path.join(home, "profiles", "nexus-abc", "state.db"), "utf8")).toBe(
      "datos",
    );

    const second = await migrateProfiles(home);
    expect(second.renamed).toHaveLength(0);
  });

  it("no toca nada si el destino ya existe", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "nexus-migrate-"));
    await mkdir(path.join(home, "profiles", "plexo-abc"), { recursive: true });
    await mkdir(path.join(home, "profiles", "nexus-abc"), { recursive: true });

    const result = await migrateProfiles(home);
    expect(result.renamed).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("no falla si no existen los directorios", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "nexus-migrate-"));
    const result = await migrateProfiles(home);
    expect(result).toEqual({ renamed: [], skipped: [], failed: [] });
  });
});
