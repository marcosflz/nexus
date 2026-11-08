import { describe, expect, it } from "vitest";
import {
  agentSpecJsonSchema,
  agentSpecSchema,
  defaultAgentSpec,
  toSidecarAgent,
} from "./spec";

describe("AgentSpec", () => {
  it("un spec mínimo se completa con valores por defecto seguros", () => {
    const spec = agentSpecSchema.parse({ name: "  Analista  " });

    expect(spec.name).toBe("Analista");
    expect(spec.schemaVersion).toBe(1);
    expect(spec.backend).toBe("nas-adk");
    expect(spec.computer.enabled).toBe(false); // el ordenador es opt-in
    expect(spec.knowledge).toEqual({ enabled: false, topK: 6 });
    expect(spec.ui).toEqual({ openui: "auto", profiles: ["minimal"] });
    expect(spec.tools).toContain("web_search");
    expect(spec.budgets).toEqual({
      maxRunsPerDay: 0,
      maxTokensPerRun: 0,
      maxTokensPerDay: 0,
      maxToolCalls: 0,
    });
  });

  it("rechaza especificaciones no válidas", () => {
    const bad = (value: unknown) => agentSpecSchema.safeParse(value).success;

    expect(bad({})).toBe(false);
    expect(bad({ name: "   " })).toBe(false);
    expect(bad({ name: "x".repeat(81) })).toBe(false);
    expect(bad({ name: "a", backend: "otro" })).toBe(false);
    expect(bad({ name: "a", starters: Array(7).fill("x") })).toBe(false);
    expect(bad({ name: "a", knowledge: { topK: 99 } })).toBe(false);
    expect(bad({ name: "a", connectors: [{ connectorId: "no-uuid" }] })).toBe(false);
    expect(bad({ name: "a", ui: { profiles: ["inventado"] } })).toBe(false);
  });

  it("es idempotente: reparsear un spec ya completo no cambia nada", () => {
    const once = agentSpecSchema.parse({ name: "A", instructions: "i", starters: ["¿hola?"] });
    expect(agentSpecSchema.parse(once)).toEqual(once);
  });

  it("el agente integrado es un spec válido", () => {
    expect(agentSpecSchema.safeParse(defaultAgentSpec()).success).toBe(true);
    expect(defaultAgentSpec({ name: "Otro" }).name).toBe("Otro");
  });

  it("traduce al contrato del sidecar", () => {
    const sidecar = toSidecarAgent(
      defaultAgentSpec({ knowledge: { enabled: true, topK: 4 }, memory: { enabled: true } }),
    );
    expect(sidecar).toMatchObject({
      name: "Nexus",
      knowledgeEnabled: true,
      knowledgeTopK: 4,
      memoryEnabled: true,
      followups: true,
      ui: { openui: "auto", profiles: ["minimal"] },
    });
  });

  it("expone un JSON Schema para el builder y el sidecar", () => {
    const schema = agentSpecJsonSchema() as { properties?: Record<string, unknown>; required?: string[] };
    expect(Object.keys(schema.properties ?? {})).toEqual(
      expect.arrayContaining(["name", "instructions", "tools", "budgets", "policy"]),
    );
    expect(schema.required).toEqual(["name"]);
  });
});
