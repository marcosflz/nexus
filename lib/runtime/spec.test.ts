import { describe, expect, it } from "vitest";
import { botInputSchema, botPatchSchema } from "@/lib/bots/spec";
import { resolveRuntime, runtimeSettingsSchema } from "./spec";

describe("Nexbot runtime configuration", () => {
  it("resolves identity and supports bots without environments or agent profiles", () => {
    const bot = botInputSchema.parse({ name: "Analista", role: "Investigar", instructions: "Cita tus fuentes" });
    expect(bot.environmentEnabled).toBe(false);
    expect(bot.skillIds).toEqual([]);
    expect(bot).not.toHaveProperty("agentIds");
    const runtime = resolveRuntime(bot, { model: { provider: "lmstudio", model: "local" } });
    expect(runtime.name).toBe("Analista");
    expect(runtime.role).toBe("Investigar");
    expect(runtime.instructions).toBe("Cita tus fuentes");
    expect(runtime.model.model).toBe("local");
    expect(runtime.memory.scope).toBe("bot");
  });
  it("keeps partial execution patches free of injected defaults", () => {
    expect(botPatchSchema.parse({ execution: { model: {} } })).toEqual({ execution: { model: {} } });
    expect(botPatchSchema.parse({ skillIds: [] })).toEqual({ skillIds: [] });
    expect(botPatchSchema.parse({})).toEqual({});
  });
  it("reads legacy memory scope as bot-local without exposing it in new settings", () => {
    expect(runtimeSettingsSchema.parse({ memory: { enabled: true, scope: "agent" } }).memory.scope).toBe("bot");
  });
});
