import { beforeEach, describe, expect, it } from "vitest";
import { botApi, botConnector, ensureBot, stopBot } from "./client";
import { botConfigSchema } from "./spec";

const BOT = "11111111-2222-4333-8444-555555555555";
const config = { url: "http://sandboxd:8095" };
const options = botConfigSchema.parse({});

function fakeFetch(respond: (url: string, init: RequestInit) => Response) {
  const seen: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return respond(url, init);
  }) as unknown as typeof fetch;
  return { impl, seen };
}

beforeEach(() => {
  process.env.NEXUS_AGENT_SECRET = "s";
});

describe("cliente de bots", () => {
  it("firma las peticiones y envía las opciones", async () => {
    const { impl, seen } = fakeFetch(() => Response.json({ state: "running" }));
    const result = await ensureBot(BOT, options, { fetch: impl, config });

    expect(result.ok).toBe(true);
    expect(seen[0].url).toBe(`http://sandboxd:8095/v1/bots/${BOT}/ensure`);
    const headers = seen[0].init.headers as Record<string, string>;
    expect(headers["X-Nexus-Signature"]).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(String(seen[0].init.body)).options.network).toBe("restricted");
  });

  it("sin sandboxd informa de que no está desplegado", async () => {
    const result = await stopBot(BOT, { config: null });
    expect(result).toMatchObject({ ok: false, status: 503 });
  });

  it("propaga el detalle de los errores", async () => {
    const { impl } = fakeFetch(() => Response.json({ detail: "El bot está detenido" }, { status: 409 }));
    expect(await botApi(BOT, "GET", "tasks", undefined, { fetch: impl, config })).toEqual({
      ok: false,
      status: 409,
      error: "El bot está detenido",
    });
  });

  it("un fallo de red no lanza", async () => {
    const impl = (async () => {
      throw new Error("conexión rechazada");
    }) as unknown as typeof fetch;
    expect(await stopBot(BOT, { fetch: impl, config })).toMatchObject({ ok: false, status: 502 });
  });

  it("construye el conector MCP solo si el bot responde", async () => {
    const up = fakeFetch(() => Response.json({ url: "http://bot:8900/mcp", headers: { Authorization: "Bearer t" } }));
    expect(await botConnector(BOT, { fetch: up.impl, config })).toMatchObject({
      name: "nexbot",
      transport: "streamable-http",
      headers: { Authorization: "Bearer t" },
    });
    const down = fakeFetch(() => Response.json({ detail: "x" }, { status: 409 }));
    expect(await botConnector(BOT, { fetch: down.impl, config })).toBeNull();
  });
});
