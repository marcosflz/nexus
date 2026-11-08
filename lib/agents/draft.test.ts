import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { draftAgentSpec, extractJson, sanitizeDraft } from "./draft";
import { agentSpecSchema, defaultAgentSpec } from "./spec";

describe("extractJson", () => {
  it("lee JSON solo, en bloque con etiqueta y rodeado de texto", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(extractJson('Aquí tienes:\n```json\n{"a": 2}\n```\nListo.')).toEqual({ a: 2 });
    expect(extractJson('Respuesta: {"a": {"b": 3}} fin')).toEqual({ a: { b: 3 } });
  });

  it("falla con claridad si no hay objeto", () => {
    expect(() => extractJson("sin json")).toThrow("JSON");
    expect(() => extractJson("{roto")).toThrow();
  });
});

describe("sanitizeDraft", () => {
  it("desactiva capacidades de riesgo y descarta herramientas desconocidas", () => {
    const risky = agentSpecSchema.parse({
      name: "Hacker",
      tools: ["web_search", "terminal", "present_openui", "rm_rf"],
      connectors: [{ connectorId: "00000000-0000-4000-8000-000000000001" }],
      computer: { enabled: true },
      policy: { allowHosts: ["evil.test"], askTools: [], allowTools: ["terminal"] },
      model: { provider: "openrouter", model: "caro" },
      budgets: { maxRunsPerDay: 5, maxTokensPerRun: 50000, maxTokensPerDay: 1, maxToolCalls: 3 },
    });

    const safe = sanitizeDraft(risky);

    expect(safe.tools).toEqual(["web_search", "present_openui"]);
    expect(safe.connectors).toEqual([]);
    expect(safe.computer.enabled).toBe(false);
    expect(safe.policy).toEqual({ allowHosts: [], askTools: [], allowTools: [] });
    expect(safe.model).toEqual({});
    expect(safe.budgets.maxTokensPerRun).toBe(50000); // un tope de gasto razonable sí se respeta
    expect(safe.budgets.maxRunsPerDay).toBe(0);
    expect(safe.name).toBe("Hacker");
  });

  it("deja intacto un borrador inocuo", () => {
    const spec = defaultAgentSpec({ name: "Analista", instructions: "Sé breve." });
    expect(sanitizeDraft(spec)).toEqual(spec);
  });
});

describe("draftAgentSpec", () => {
  const credential = { provider: "openrouter", model: "m", apiKey: "sk-test", baseUrl: null };
  const previous = { url: process.env.NEXUS_AGENT_URL, secret: process.env.NEXUS_AGENT_SECRET };

  beforeEach(() => {
    process.env.NEXUS_AGENT_URL = "http://agent:8090";
    process.env.NEXUS_AGENT_SECRET = "s";
  });
  afterEach(() => {
    process.env.NEXUS_AGENT_URL = previous.url;
    process.env.NEXUS_AGENT_SECRET = previous.secret;
    if (previous.url === undefined) delete process.env.NEXUS_AGENT_URL;
    if (previous.secret === undefined) delete process.env.NEXUS_AGENT_SECRET;
  });

  const answer = (text: string, status = 200) =>
    (async () => new Response(JSON.stringify(status === 200 ? { text } : { error: text }), { status })) as typeof fetch;

  it("devuelve un spec válido y saneado a partir de la respuesta del modelo", async () => {
    const result = await draftAgentSpec(
      "Un asesor fiscal para autónomos",
      credential,
      {
        fetch: answer(
          '```json\n{"name":"Asesor fiscal","role":"Ayuda con impuestos","instructions":"Sé claro.","avatar":"🧾","tools":["web_search","terminal"],"computer":{"enabled":true}}\n```',
        ),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.name).toBe("Asesor fiscal");
      expect(result.spec.tools).toEqual(["web_search"]);
      expect(result.spec.computer.enabled).toBe(false);
    }
  });

  it("no envía la API key a ningún sitio que no sea el sidecar firmado", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    await draftAgentSpec("x", credential, {
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, headers: init.headers as Record<string, string> };
        return new Response(JSON.stringify({ text: '{"name":"A"}' }));
      }) as typeof fetch,
    });
    expect(seen!.url).toBe("http://agent:8090/v1/complete");
    expect(seen!.headers["X-Nexus-Signature"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("explica por qué falla: borrador inválido, sin JSON o error del motor", async () => {
    const invalid = await draftAgentSpec("x", credential, { fetch: answer('{"role":"sin nombre"}') });
    expect(invalid.ok === false && invalid.error).toContain("no es válido");

    const noJson = await draftAgentSpec("x", credential, { fetch: answer("Lo siento, no puedo.") });
    expect(noJson.ok === false && noJson.error).toContain("JSON");

    const down = await draftAgentSpec("x", credential, { fetch: answer("sin crédito", 502) });
    expect(down.ok === false && down.error).toContain("sin crédito");
  });

  it("sin sidecar configurado lo dice", async () => {
    delete process.env.NEXUS_AGENT_URL;
    const result = await draftAgentSpec("x", credential, { fetch: answer("") });
    expect(result.ok === false && result.error).toContain("no está configurado");
  });
});
