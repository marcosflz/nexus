import { describe, expect, it } from "vitest";
import { evaluateToolCall, kindOfTool, type GatewayDeps, type ToolCallContext } from "./gateway";
import { decideAction } from "./engine";

function setup(options: { approvals?: boolean } = {}) {
  const audit: { tool: string; effect: string; rule: string }[] = [];
  const approvals: { tool: string; rule: string }[] = [];
  const deps: GatewayDeps = {
    decide: decideAction,
    approvalsEnabled: () => options.approvals ?? true,
    async record(row) {
      audit.push({ tool: row.tool, effect: row.effect, rule: row.rule });
    },
    async createApproval(row) {
      approvals.push({ tool: row.tool, rule: row.rule });
      return `approval-${approvals.length}`;
    },
  };
  return { deps, audit, approvals };
}

const run = (initiator: "user" | "routine" | "trigger" = "user") => ({
  id: "r1",
  threadId: "t1",
  userId: "u1",
  initiator,
});
const call = (tool: string, args: unknown = {}, initiator: "user" | "routine" | "trigger" = "user"): ToolCallContext => ({
  tool,
  args,
  run: run(initiator),
});

describe("kindOfTool", () => {
  it("clasifica las herramientas del sidecar", () => {
    expect(kindOfTool("web_search")).toBe("web");
    expect(kindOfTool("web_fetch")).toBe("web");
    expect(kindOfTool("browser_click")).toBe("browser");
    expect(kindOfTool("github__create_issue")).toBe("connector");
    expect(kindOfTool("knowledge_search")).toBe("agent");
  });
});

describe("evaluateToolCall", () => {
  it("permite las lecturas web de un usuario y las audita", async () => {
    const { deps, audit } = setup();
    const verdict = await evaluateToolCall(call("web_search", { query: "x" }), deps);

    expect(verdict).toMatchObject({ effect: "allow", rule: "allow-web" });
    expect(audit).toEqual([{ tool: "web_search", effect: "allow", rule: "allow-web" }]);
  });

  it("trata web_fetch como lectura web (alias de web_extract)", async () => {
    const { deps } = setup();
    expect((await evaluateToolCall(call("web_fetch", { url: "https://a.test" }), deps)).effect).toBe("allow");
  });

  it("deniega objetivos de red privada aunque la herramienta sea de lectura", async () => {
    const { deps, audit } = setup();
    const verdict = await evaluateToolCall(call("web_fetch", { url: "http://169.254.169.254/x" }), deps);

    expect(verdict).toMatchObject({ effect: "deny", rule: "deny-private-host" });
    expect(audit[0].effect).toBe("deny");
  });

  it("deniega por defecto lo que no conoce", async () => {
    const { deps } = setup();
    expect(await evaluateToolCall(call("herramienta_rara"), deps)).toMatchObject({
      effect: "deny",
      rule: "default-deny",
    });
  });

  it("permite las herramientas propias de Nexus", async () => {
    const { deps } = setup();
    for (const tool of ["knowledge_search", "remember", "recall", "forget"]) {
      expect((await evaluateToolCall(call(tool), deps)).effect, tool).toBe("allow");
    }
  });

  it("un conector se permite al usuario pero pide aprobación a una rutina", async () => {
    const { deps, approvals } = setup();
    expect((await evaluateToolCall(call("github__search"), deps)).effect).toBe("allow");

    const routine = await evaluateToolCall(call("github__create_issue", { t: 1 }, "routine"), deps);
    expect(routine).toMatchObject({ effect: "ask", approvalId: "approval-1" });
    expect(approvals).toEqual([{ tool: "github__create_issue", rule: "ask-scheduled-write" }]);
  });

  it("una rutina que solo lee la web no necesita aprobación", async () => {
    const { deps } = setup();
    expect((await evaluateToolCall(call("web_search", {}, "routine"), deps)).effect).toBe("allow");
  });

  it("los clicks del navegador piden aprobación y se registran antes de devolver", async () => {
    const { deps, audit } = setup();
    const verdict = await evaluateToolCall(call("browser_click", { selector: "#buy" }), deps);

    expect(verdict.effect).toBe("ask");
    expect(audit.map((row) => row.effect)).toEqual(["ask"]);
  });

  it("con las aprobaciones desactivadas, un ask pasa a deny y no crea aprobación", async () => {
    const { deps, approvals, audit } = setup({ approvals: false });
    const verdict = await evaluateToolCall(call("browser_click"), deps);

    expect(verdict.effect).toBe("deny");
    expect(verdict.rule).toContain("approvals-off");
    expect(approvals).toEqual([]);
    expect(audit[0].effect).toBe("deny");
  });

  it("las herramientas del navegador del agente (conector «browser») usan las reglas de navegador", async () => {
    const { deps } = setup();
    const read = await evaluateToolCall(call("browser__browser_snapshot"), deps);
    expect(read).toMatchObject({ effect: "allow", rule: "allow-browser-read" });

    const write = await evaluateToolCall(call("browser__browser_click", { selector: "#comprar" }), deps);
    expect(write).toMatchObject({ effect: "ask", rule: "ask-browser-write" });

    const toLan = await evaluateToolCall(call("browser__browser_navigate", { url: "http://192.168.1.1/admin" }), deps);
    expect(toLan).toMatchObject({ effect: "deny", rule: "deny-private-host" });
  });

  it("con una persona al mando el agente no puede tocar el navegador, ni siquiera leer", async () => {
    const { deps } = setup();
    const verdict = await evaluateToolCall({ ...call("browser__browser_snapshot"), humanInControl: true }, deps);
    expect(verdict).toMatchObject({ effect: "deny", rule: "human-in-control" });
    // …pero sus otras herramientas siguen funcionando.
    expect((await evaluateToolCall({ ...call("web_search"), humanInControl: true }, deps)).effect).toBe("allow");
  });
});
