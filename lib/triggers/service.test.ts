import { describe, expect, it } from "vitest";
import { prepareTrigger } from "./service";
import { verifyHookToken } from "./hooks";

const NOW = new Date("2026-03-27T10:00:00Z");

describe("prepareTrigger", () => {
  it("cron: valida y calcula la primera ejecución en su zona horaria", () => {
    const result = prepareTrigger({ kind: "cron", config: { expr: "0 9 * * *", tz: "Europe/Madrid" } }, NOW);
    expect(result.ok && result.nextRunAt?.toISOString()).toBe("2026-03-28T08:00:00.000Z");
  });

  it("cron: rechaza lo demasiado frecuente o inválido", () => {
    expect(prepareTrigger({ kind: "cron", config: { expr: "* * * * *" } }, NOW).ok).toBe(false);
    expect(prepareTrigger({ kind: "cron", config: { expr: "basura" } }, NOW).ok).toBe(false);
    expect(prepareTrigger({ kind: "cron", config: { expr: "0 9 * * *", tz: "Nada/Nada" } }, NOW).ok).toBe(false);
  });

  it("webhook: genera un token que se devuelve una vez y solo se guarda su hash", () => {
    const result = prepareTrigger({ kind: "webhook", config: {} });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.webhookToken).toBeTruthy();
      expect(JSON.stringify(result.config)).not.toContain(result.webhookToken!);
      expect(verifyHookToken(result.webhookToken!, result.config.tokenHash as string)).toBe(true);
      expect(result.nextRunAt).toBeNull();
    }
  });

  it("rss y watch: exigen URL http(s) y fijan un intervalo mínimo", () => {
    expect(prepareTrigger({ kind: "rss", config: { url: "ftp://x" } }).ok).toBe(false);
    const fast = prepareTrigger({ kind: "watch", config: { url: "https://a.test", intervalMin: 1 } }, NOW);
    expect(fast.ok && fast.config.intervalMin).toBe(15);
    expect(fast.ok && fast.nextRunAt?.toISOString()).toBe("2026-03-27T10:15:00.000Z");
    const slow = prepareTrigger({ kind: "rss", config: { url: "https://a.test", intervalMin: 999999 } }, NOW);
    expect(slow.ok && slow.config.intervalMin).toBe(1440);
  });

  it("agent_completed: exige un id de agente", () => {
    expect(prepareTrigger({ kind: "agent_completed", config: {} }).ok).toBe(false);
    expect(
      prepareTrigger({ kind: "agent_completed", config: { sourceAgentId: "11111111-1111-4111-8111-111111111111" } }).ok,
    ).toBe(true);
  });
});
