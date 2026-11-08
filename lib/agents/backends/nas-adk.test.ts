import { describe, expect, it } from "vitest";
import { verifyRunToken } from "@/lib/internal/token";
import type { AgUiEvent } from "@/lib/agui/events";
import type { BackendRunInput } from "../backend";
import { buildSidecarRequest, createNasAdkBackend, nasAdkConfig } from "./nas-adk";

const SECRET = "secreto-test";
const CONFIG = { url: "http://agent:8090", internalUrl: "http://app:3000" };

const input: BackendRunInput = {
  runId: "run-1",
  threadId: "thread-1",
  userId: "user-1",
  initiator: "user",
  credential: { provider: "openrouter", model: "m", apiKey: "sk-test", baseUrl: null },
  userText: "hola",
};

const frame = (event: object) => `data: ${JSON.stringify(event)}\n\n`;
const result = (value: object) => ({ type: "CUSTOM", name: "nexus.result", value });

function sidecar(frames: string[], status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFake: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const f of frames) controller.enqueue(encoder.encode(f));
          controller.close();
        },
      }),
      { status },
    );
  };
  return { fetchFake, calls };
}

async function run(frames: string[], overrides: Partial<BackendRunInput> = {}) {
  process.env.NEXUS_AGENT_SECRET = SECRET;
  const { fetchFake, calls } = sidecar(frames);
  const emitted: AgUiEvent[] = [];
  const backend = createNasAdkBackend({ fetch: fetchFake, config: CONFIG, now: () => 1_700_000_000_000 });
  const outcome = await backend.run({ ...input, ...overrides }, (e) => emitted.push(e), new AbortController().signal);
  return { outcome, emitted, calls };
}

describe("createNasAdkBackend", () => {
  it("reenvía los eventos y devuelve el resultado de un turno correcto", async () => {
    const { outcome, emitted } = await run([
      frame({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Hola" }),
      frame(
        result({
          outcome: "success",
          finalText: "Hola",
          usage: { input: 3, output: 1, total: 4 },
          sources: [{ id: 1, url: "https://a.test", domain: "a.test" }],
          followups: ["¿Y después?"],
        }),
      ),
    ]);

    expect(emitted).toHaveLength(1); // el resultado NO se reenvía como evento
    expect(outcome).toMatchObject({
      outcome: "success",
      finalText: "Hola",
      followups: ["¿Y después?"],
      usage: { total: 4 },
    });
    expect(outcome.sources).toHaveLength(1);
  });

  it("firma la petición y manda un token de run atado al run y al usuario", async () => {
    const { calls } = await run([frame(result({ outcome: "success", finalText: "ok" }))]);

    const { url, init } = calls[0];
    const headers = init.headers as Record<string, string>;
    expect(url).toBe("http://agent:8090/v1/runs");
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["X-Nexus-Signature"]).toMatch(/^[0-9a-f]{64}$/);

    const body = JSON.parse(init.body as string);
    expect(body.bff.baseUrl).toBe("http://app:3000");
    expect(verifyRunToken(body.bff.runToken, { secret: SECRET, now: 1_700_000_000_000 })).toMatchObject({
      runId: "run-1",
      userId: "user-1",
    });
  });

  it("una pausa devuelve interrupts y el checkpoint para reanudar", async () => {
    const { outcome } = await run([
      frame(
        result({
          outcome: "interrupt",
          interrupts: [{ id: "i1", reason: "openui_form", toolCallId: "c1" }],
          checkpoint: [{ role: "assistant" }],
        }),
      ),
    ]);

    expect(outcome.outcome).toBe("interrupt");
    expect(outcome.interrupts?.[0]).toMatchObject({ id: "i1", toolCallId: "c1" });
    expect(outcome.checkpoint).toEqual([{ role: "assistant" }]);
  });

  it("un error del motor se propaga como excepción", async () => {
    await expect(run([frame(result({ outcome: "error", message: "sin crédito" }))])).rejects.toThrow(
      "sin crédito",
    );
  });

  it("falla si el stream acaba sin resultado o el sidecar responde con error", async () => {
    await expect(run([frame({ type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "x" })])).rejects.toThrow(
      "sin devolver un resultado",
    );

    process.env.NEXUS_AGENT_SECRET = SECRET;
    const { fetchFake } = sidecar([], 401);
    const backend = createNasAdkBackend({ fetch: fetchFake, config: CONFIG });
    await expect(backend.run(input, () => {}, new AbortController().signal)).rejects.toThrow("401");
  });

  it("sin configuración el motor se niega a arrancar", async () => {
    const backend = createNasAdkBackend({ config: null });
    await expect(backend.run(input, () => {}, new AbortController().signal)).rejects.toThrow(
      "no está configurado",
    );
  });
});

describe("buildSidecarRequest", () => {
  it("al reanudar no envía el mensaje del usuario y sí las respuestas", () => {
    const body = buildSidecarRequest(
      {
        ...input,
        checkpoint: [{ a: 1 }],
        resume: [{ callId: "c1", status: "resolved", payload: { x: 1 } }],
      },
      CONFIG,
      "tok",
    );
    expect(body.userText).toBeNull();
    expect(body.resume).toEqual([{ callId: "c1", status: "resolved", payload: { x: 1 } }]);
    expect(body.checkpoint).toEqual([{ a: 1 }]);
  });

  it("recorta el historial y respeta el presupuesto de tokens del agente", () => {
    const history = Array.from({ length: 40 }, (_, i) => ({
      role: (i % 2 ? "assistant" : "user") as "user" | "assistant",
      content: "x".repeat(9000),
    }));
    const body = buildSidecarRequest({ ...input, history }, CONFIG, "tok");

    expect(body.history).toHaveLength(24);
    expect(body.history[0].content).toHaveLength(6000);
    expect(body.limits.maxTotalTokens).toBeNull();
  });
});

describe("nasAdkConfig", () => {
  it("exige URL y secreto", () => {
    expect(nasAdkConfig({})).toBeNull();
    expect(nasAdkConfig({ NEXUS_AGENT_URL: "http://a" })).toBeNull();
    expect(nasAdkConfig({ NEXUS_AGENT_URL: "http://a/", NEXUS_AGENT_SECRET: "s" })).toEqual({
      url: "http://a",
      internalUrl: "http://127.0.0.1:3000",
    });
  });
});

describe("buildSidecarRequest · interfaz generativa", () => {
  it("manda la especificación y la petición del usuario solo si la UI está activa", () => {
    const off = buildSidecarRequest(input, CONFIG, "t");
    expect(off.ui).toBeNull();

    const asked = buildSidecarRequest(
      { ...input, openui: true, openuiProfile: "minimal", openuiRequested: true },
      CONFIG,
      "t",
    );
    expect(asked.ui).toMatchObject({ requested: true, profile: "minimal" });
    expect(asked.ui?.spec).toContain("root");
  });
});

describe("límites y errores del motor", () => {
  it("manda el contexto máximo y traduce los errores de presupuesto", async () => {
    const { contextTokens, friendlyAgentError } = await import("./nas-adk");
    expect(contextTokens({})).toBe(64_000);
    expect(contextTokens({ NEXUS_AGENT_CONTEXT_TOKENS: "120000" })).toBe(120_000);
    expect(contextTokens({ NEXUS_AGENT_CONTEXT_TOKENS: "10" })).toBe(64_000);
    expect(buildSidecarRequest(input, CONFIG, "t").limits.maxContextTokens).toBeGreaterThanOrEqual(8000);
    expect(friendlyAgentError("BudgetExceeded: Current turn exceeds the context budget")).toMatch(/contexto/);
    expect(friendlyAgentError("otra cosa")).toBe("otra cosa");
  });
});

describe("instrucciones del turno", () => {
  it("manda al sidecar las instrucciones del foco y de Research", async () => {
    const { turnInstructions } = await import("./nas-adk");
    expect(turnInstructions({})).toBeNull();
    expect(turnInstructions({ mode: "research" })).toMatch(/Modo Research/);
    const both = turnInstructions({ mode: "research", focus: "academic" });
    expect(both).toMatch(/Modo Research/);
    expect(buildSidecarRequest({ ...input, mode: "research" }, CONFIG, "t").turnInstructions).toMatch(/Research/);
  });
});

describe("sidecarCapabilities", () => {
  it("firma la consulta y devuelve lo que dice el sidecar", async () => {
    process.env.NEXUS_AGENT_SECRET = SECRET;
    const { sidecarCapabilities } = await import("./nas-adk");
    let seen: RequestInit | undefined;
    const fake: typeof fetch = async (_url, init) => {
      seen = init;
      return Response.json({ claudeCode: { available: true, reason: null } });
    };
    const result = await sidecarCapabilities({ fetch: fake, config: CONFIG });
    expect(result.claudeCode.available).toBe(true);
    expect((seen?.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
  });

  it("si el sidecar no responde, Claude Code queda no disponible con un motivo", async () => {
    process.env.NEXUS_AGENT_SECRET = SECRET;
    const { sidecarCapabilities } = await import("./nas-adk");
    const broken: typeof fetch = async () => {
      throw new Error("conexión rechazada");
    };
    const result = await sidecarCapabilities({ fetch: broken, config: CONFIG });
    expect(result.claudeCode).toEqual({ available: false, reason: "El motor de agentes no responde." });
  });
});
