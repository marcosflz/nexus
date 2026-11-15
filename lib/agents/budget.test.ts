import { describe, expect, it } from "vitest";
import { evaluateBudget, startOfUtcDay } from "./budget";
import { defaultAgentSpec } from "./spec";

const budgets = (overrides: Partial<ReturnType<typeof defaultAgentSpec>["budgets"]>) => ({
  ...defaultAgentSpec().budgets,
  ...overrides,
});

describe("evaluateBudget", () => {
  it("0 significa sin límite", () => {
    expect(evaluateBudget(budgets({}), { runsToday: 9999, tokensToday: 9e9 })).toEqual({ ok: true });
  });

  it("corta al alcanzar el máximo de ejecuciones, no antes", () => {
    const limits = budgets({ maxRunsPerDay: 3 });
    expect(evaluateBudget(limits, { runsToday: 2, tokensToday: 0 }).ok).toBe(true);
    const over = evaluateBudget(limits, { runsToday: 3, tokensToday: 0 });
    expect(over.ok).toBe(false);
    expect(over.ok === false && over.reason).toContain("3 ejecuciones");
  });

  it("corta al alcanzar el máximo de tokens", () => {
    const limits = budgets({ maxTokensPerDay: 1000 });
    expect(evaluateBudget(limits, { runsToday: 0, tokensToday: 999 }).ok).toBe(true);
    expect(evaluateBudget(limits, { runsToday: 0, tokensToday: 1000 }).ok).toBe(false);
  });
});

describe("startOfUtcDay", () => {
  it("devuelve la medianoche UTC del día", () => {
    expect(startOfUtcDay(new Date("2026-11-07T23:59:59Z")).toISOString()).toBe("2026-11-07T00:00:00.000Z");
  });
});
