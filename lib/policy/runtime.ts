import type { AgentSpec } from "@/lib/agents/spec";
import { hostsInArgs } from "./defaults";
import { decideAction } from "./engine";
import { policyToolName } from "./gateway";
import type { ActionRequest, PolicyDecision } from "./types";

/** Per-bot restrictions are applied to the policy snapshot, below instance denials. */
export async function decideRuntimeAction(request: ActionRequest, spec?: AgentSpec): Promise<PolicyDecision> {
  request = { ...request, tool: policyToolName(request.tool) };
  const base = await decideAction(request);
  if (!spec || (base.effect === "deny" && base.rule !== "default-deny")) return base;
  if (spec.policy.allowHosts.length && hostsInArgs(request.args).some((host) => !spec.policy.allowHosts.some((allowed) => host === allowed || (allowed.startsWith("*.") && host.endsWith(allowed.slice(1)))))) return { effect: "deny", rule: "nexbot-hosts", reason: "El destino no está permitido por la configuración del Nexbot." };
  if (spec.policy.askTools.some((name) => policyToolName(name) === request.tool)) return { effect: "ask", rule: "nexbot-ask", reason: "La configuración del Nexbot requiere aprobación." };
  if (base.rule === "default-deny" && spec.policy.allowTools.some((name) => policyToolName(name) === request.tool)) return { effect: "allow", rule: "nexbot-allow" };
  return base;
}
