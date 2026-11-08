import { hostsInArgs } from "./defaults";
import { decideAction } from "./engine";
import type { ActionKind, ActionRequest, PolicyDecision } from "./types";
import { isConnectorTool } from "./defaults";

/**
 * Nombres con los que el sidecar expone herramientas que el motor de políticas
 * conoce con otro nombre (el catálogo viene de las herramientas de Hermes).
 */
const POLICY_ALIASES: Record<string, string> = {
  web_fetch: "web_extract",
};

/**
 * El navegador del agente es un conector MCP llamado `browser`, así que sus
 * herramientas llegan como `browser__browser_click`. El motor de políticas las
 * conoce como `browser_click`: se quita el prefijo del conector.
 */
export const BROWSER_PREFIX = "browser__";

export function policyToolName(tool: string): string {
  if (tool.startsWith(BROWSER_PREFIX)) return tool.slice(BROWSER_PREFIX.length);
  return POLICY_ALIASES[tool] ?? tool;
}

export function kindOfTool(tool: string): ActionKind {
  if (tool === "web_search" || tool === "web_fetch" || tool === "web_extract") return "web";
  if (tool.startsWith(BROWSER_PREFIX) || tool.startsWith("browser_")) return "browser";
  if (isConnectorTool(tool)) return "connector";
  return "agent";
}

export interface ToolCallContext {
  tool: string;
  args: unknown;
  toolCallId?: string;
  run: { id: string; threadId: string; userId: string; initiator: "user" | "routine" | "trigger" };
  humanInControl?: boolean;
}

export interface GatewayVerdict {
  effect: PolicyDecision["effect"];
  rule: string;
  reason?: string;
  approvalId?: string;
}

export interface GatewayDeps {
  decide(request: ActionRequest): Promise<PolicyDecision>;
  record(row: {
    userId: string;
    threadId: string;
    runId: string;
    tool: string;
    kind: ActionKind;
    effect: PolicyDecision["effect"];
    rule: string;
    reason?: string | null;
    target?: unknown;
    args?: unknown;
  }): Promise<void>;
  createApproval(row: {
    runId: string;
    userId: string;
    toolCallId?: string;
    tool: string;
    args: unknown;
    rule: string;
    reason?: string | null;
  }): Promise<string>;
  approvalsEnabled(): boolean;
}

/**
 * Decide si una llamada a herramienta del sidecar puede ejecutarse.
 *
 * Orden deliberado: se decide, se **audita** y solo entonces se devuelve el
 * veredicto, de modo que no existe una acción permitida sin su fila de
 * auditoría. Si las aprobaciones están desactivadas, un `ask` se convierte en
 * `deny`: nunca se ejecuta algo que pedía permiso sin que nadie lo conceda.
 */
export async function evaluateToolCall(
  call: ToolCallContext,
  deps: GatewayDeps,
): Promise<GatewayVerdict> {
  const tool = policyToolName(call.tool);
  const kind = kindOfTool(call.tool);
  const [host] = hostsInArgs(call.args);

  let decision = await deps.decide({
    kind,
    tool,
    args: call.args,
    target: host ? { host } : undefined,
    runId: call.run.id,
    threadId: call.run.threadId,
    userId: call.run.userId,
    initiator: call.run.initiator === "user" ? "user" : "routine",
    humanInControl: call.humanInControl,
  });

  if (decision.effect === "ask" && !deps.approvalsEnabled()) {
    decision = {
      effect: "deny",
      rule: `${decision.rule}:approvals-off`,
      reason: "La acción requiere aprobación y las aprobaciones están desactivadas.",
    };
  }

  await deps.record({
    userId: call.run.userId,
    threadId: call.run.threadId,
    runId: call.run.id,
    tool: call.tool,
    kind,
    effect: decision.effect,
    rule: decision.rule,
    reason: decision.reason ?? null,
    target: host ? { host } : null,
    args: call.args,
  });

  if (decision.effect !== "ask") {
    return { effect: decision.effect, rule: decision.rule, reason: decision.reason };
  }

  const approvalId = await deps.createApproval({
    runId: call.run.id,
    userId: call.run.userId,
    toolCallId: call.toolCallId,
    tool: call.tool,
    args: call.args,
    rule: decision.rule,
    reason: decision.reason ?? null,
  });
  return { effect: "ask", rule: decision.rule, reason: decision.reason, approvalId };
}

export { decideAction };
