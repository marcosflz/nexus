import { describe, expect, it } from "vitest";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { decideRuntimeAction } from "./runtime";
import type { ActionRequest } from "./types";

const request = (tool: string, args: unknown = {}, initiator: ActionRequest["initiator"] = "user"): ActionRequest => ({ tool, args, initiator, kind: "agent", runId: "run", threadId: "thread", userId: "user" });

describe("skills and Nexbot policies", () => {
  it("permits catalog reads in a room and routines while still denying scripts in rooms", async () => {
    expect((await decideRuntimeAction(request("activate_skill", {}, "room"))).effect).toBe("allow");
    expect((await decideRuntimeAction(request("read_skill_file", {}, "routine"))).effect).toBe("allow");
    expect((await decideRuntimeAction(request("run_skill_script", {}, "room"))).effect).toBe("deny");
    expect((await decideRuntimeAction(request("run_skill_script"))).effect).toBe("ask");
  });
  it("applies bot restrictions without overriding instance denials or script approval", async () => {
    const spec = defaultAgentSpec({ policy: { allowHosts: ["example.com"], askTools: ["read_skill_file"], allowTools: ["run_skill_script", "terminal"] } });
    expect((await decideRuntimeAction(request("web_fetch", { url: "https://outside.example" }), spec)).effect).toBe("deny");
    expect((await decideRuntimeAction(request("web_fetch", { url: "https://example.com" }), spec)).effect).toBe("allow");
    expect((await decideRuntimeAction(request("read_skill_file"), spec)).effect).toBe("ask");
    expect((await decideRuntimeAction(request("run_skill_script"), spec)).effect).toBe("ask");
    expect((await decideRuntimeAction(request("terminal"), spec)).effect).toBe("deny");
  });
});
