import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureBrowser, sandboxConfig } from "./client";

const AGENT = "11111111-2222-4333-8444-555555555555";

describe("sandboxConfig", () => {
  it("exige URL y secreto", () => {
    expect(sandboxConfig({})).toBeNull();
    expect(sandboxConfig({ NEXUS_SANDBOXD_URL: "http://s" })).toBeNull();
    expect(sandboxConfig({ NEXUS_SANDBOXD_URL: "http://s/", NEXUS_AGENT_SECRET: "x" })).toEqual({ url: "http://s" });
  });
});

describe("ensureBrowser", () => {
  const previous = process.env.NEXUS_AGENT_SECRET;
  beforeEach(() => void (process.env.NEXUS_AGENT_SECRET = "secreto"));
  afterEach(() => {
    if (previous === undefined) delete process.env.NEXUS_AGENT_SECRET;
    else process.env.NEXUS_AGENT_SECRET = previous;
  });

  it("devuelve el conector MCP llamado «browser» con una petición firmada", async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const result = await ensureBrowser(AGENT, {
      config: { url: "http://sandboxd:8095" },
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, headers: init.headers as Record<string, string> };
        return new Response(JSON.stringify({ url: "http://nexus-sbx-11111111:8931/mcp" }));
      }) as typeof fetch,
    });

    expect(result.ok && result.link).toMatchObject({ name: "browser", url: "http://nexus-sbx-11111111:8931/mcp", transport: "streamable-http" });
    expect(seen!.url).toBe(`http://sandboxd:8095/v1/workspaces/${AGENT}/ensure`);
    expect(seen!.headers["X-Nexus-Signature"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("explica el fallo en lugar de lanzar", async () => {
    const down = await ensureBrowser(AGENT, { config: { url: "http://x" }, fetch: (async () => new Response("", { status: 502 })) as typeof fetch });
    expect(down.ok === false && down.error).toContain("502");
    const none = await ensureBrowser(AGENT, { config: null });
    expect(none.ok === false && none.error).toContain("no está desplegado");
    const boom = await ensureBrowser(AGENT, { config: { url: "http://x" }, fetch: (async () => { throw new Error("red caída"); }) as typeof fetch });
    expect(boom.ok === false && boom.error).toBe("red caída");
  });
});
