import { describe, expect, it } from "vitest";
import { nextCronRun, validateCron } from "./cron";

describe("nextCronRun", () => {
  it("respeta la zona horaria y el cambio de hora", () => {
    // Madrid pasa a horario de verano el 29-mar-2026: las 9:00 pasan de UTC+1 a UTC+2.
    const before = nextCronRun("0 9 * * *", "Europe/Madrid", new Date("2026-03-27T10:00:00Z"));
    const after = nextCronRun("0 9 * * *", "Europe/Madrid", new Date("2026-03-29T10:00:00Z"));
    expect(before.toISOString()).toBe("2026-03-28T08:00:00.000Z");
    expect(after.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });

  it("es estrictamente posterior a la fecha dada", () => {
    const at = new Date("2026-03-27T08:00:00Z");
    expect(nextCronRun("0 9 * * *", "Europe/Madrid", at).getTime()).toBeGreaterThan(at.getTime());
  });

  it("solo días laborables", () => {
    const friday = nextCronRun("0 9 * * 1-5", "UTC", new Date("2026-03-27T10:00:00Z"));
    expect(friday.toISOString()).toBe("2026-03-30T09:00:00.000Z"); // salta el fin de semana
  });
});

describe("validateCron", () => {
  const now = new Date("2026-03-27T00:00:00Z");

  it("acepta frecuencias razonables", () => {
    expect(validateCron("0 9 * * *", "Europe/Madrid", now).ok).toBe(true);
    expect(validateCron("*/15 * * * *", "UTC", now).ok).toBe(true);
  });

  it("rechaza lo que se ejecutaría demasiado a menudo", () => {
    const result = validateCron("* * * * *", "UTC", now);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("5 minutos");
    expect(validateCron("*/2 * * * *", "UTC", now).ok).toBe(false);
  });

  it("rechaza expresiones y zonas horarias inválidas", () => {
    expect(validateCron("no es cron", "UTC", now).ok).toBe(false);
    expect(validateCron("0 9 * * *", "Marte/Olympus", now).ok).toBe(false);
    expect(validateCron("99 9 * * *", "UTC", now).ok).toBe(false);
  });
});
