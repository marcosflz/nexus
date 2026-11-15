import { afterEach, describe, expect, it, vi } from "vitest";
import { readEnv, readFlag, resetEnvWarnings } from "./env";

describe("readEnv", () => {
  afterEach(() => {
    delete process.env.NEXUS_TEST_X;
    delete process.env.PLEXO_TEST_X;
    resetEnvWarnings();
    vi.restoreAllMocks();
  });

  it("prefiere NEXUS_* sobre el alias PLEXO_*", () => {
    process.env.NEXUS_TEST_X = "nuevo";
    process.env.PLEXO_TEST_X = "viejo";
    expect(readEnv("NEXUS_TEST_X", "PLEXO_TEST_X")).toBe("nuevo");
  });

  it("usa el alias heredado y avisa una sola vez", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.PLEXO_TEST_X = "viejo";
    expect(readEnv("NEXUS_TEST_X", "PLEXO_TEST_X")).toBe("viejo");
    expect(readEnv("NEXUS_TEST_X", "PLEXO_TEST_X")).toBe("viejo");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("devuelve undefined si no hay ninguna", () => {
    expect(readEnv("NEXUS_TEST_X", "PLEXO_TEST_X")).toBeUndefined();
  });
});

describe("readFlag", () => {
  afterEach(() => {
    delete process.env.NEXUS_TEST_F;
    delete process.env.PLEXO_TEST_F;
    resetEnvWarnings();
  });

  it("aplica el valor por defecto y entiende on/off", () => {
    expect(readFlag("NEXUS_TEST_F", "PLEXO_TEST_F", true)).toBe(true);
    process.env.NEXUS_TEST_F = "off";
    expect(readFlag("NEXUS_TEST_F", "PLEXO_TEST_F", true)).toBe(false);
    process.env.NEXUS_TEST_F = "on";
    expect(readFlag("NEXUS_TEST_F", "PLEXO_TEST_F", false)).toBe(true);
  });
});
