import { describe, expect, it } from "vitest";
import { decideAction, decideWithRules } from "./engine";
import type { ActionRequest, PolicyRule } from "./types";

function request(overrides: Partial<ActionRequest> = {}): ActionRequest {
  return {
    kind: "web",
    tool: "web_search",
    args: {},
    runId: "r1",
    threadId: "t1",
    userId: "u1",
    initiator: "user",
    ...overrides,
  };
}

describe("decideAction", () => {
  it("permite las lecturas web habituales", async () => {
    await expect(decideAction(request())).resolves.toMatchObject({ effect: "allow" });
    await expect(
      decideAction(
        request({ kind: "browser", tool: "browser_navigate", args: { url: "https://example.com" } }),
      ),
    ).resolves.toMatchObject({ effect: "allow", rule: "allow-browser-read" });
  });

  it("deniega cualquier destino de la red local o de metadatos", async () => {
    const local = await decideAction(
      request({ kind: "browser", tool: "browser_navigate", args: { url: "http://localhost:3000" } }),
    );
    expect(local.effect).toBe("deny");
    expect(local.rule).toBe("deny-private-host");

    const metadata = await decideAction(
      request({
        kind: "browser",
        tool: "browser_navigate",
        args: { url: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    expect(metadata.effect).toBe("deny");

    const lan = await decideAction(
      request({ kind: "browser", tool: "browser_navigate", args: { url: "http://192.168.1.1/" } }),
    );
    expect(lan.effect).toBe("deny");
  });

  it("deniega lo que aún no está habilitado", async () => {
    await expect(decideAction(request({ kind: "terminal", tool: "terminal" }))).resolves.toMatchObject(
      { effect: "deny", rule: "deny-terminal" },
    );
    await expect(
      decideAction(request({ kind: "file", tool: "write_file" })),
    ).resolves.toMatchObject({ effect: "deny", rule: "deny-file-tools" });
  });

  it("pide aprobación para escribir en una página", async () => {
    await expect(
      decideAction(request({ kind: "browser", tool: "browser_click" })),
    ).resolves.toMatchObject({ effect: "ask", rule: "ask-browser-write" });
  });

  it("deniega por defecto una herramienta desconocida", async () => {
    await expect(
      decideAction(request({ kind: "agent", tool: "herramienta_inventada" })),
    ).resolves.toMatchObject({ effect: "deny", rule: "default-deny" });
  });

  it("bloquea al agente mientras una persona conduce el navegador", async () => {
    await expect(
      decideAction(request({ kind: "browser", tool: "browser_click", humanInControl: true })),
    ).resolves.toMatchObject({ effect: "deny", rule: "human-in-control" });
  });

  it("deniega si una regla lanza, aunque otra permita", () => {
    const rules: PolicyRule[] = [
      { id: "allow-all", effect: "allow", when: () => true },
      {
        id: "explota",
        effect: "deny",
        when: () => {
          throw new Error("regla rota");
        },
      },
    ];

    expect(decideWithRules(rules, request())).toMatchObject({
      effect: "deny",
      rule: "explota:error",
    });
  });
});
