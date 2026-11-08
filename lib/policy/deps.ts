import { db } from "@/lib/db";
import { approvals } from "@/lib/db/schema";
import { recordAction, redactArgs } from "@/lib/audit/store";
import { approvalsEnabled } from "@/lib/flags";
import { decideAction } from "./engine";
import type { GatewayDeps } from "./gateway";

/** Dependencias reales del gateway: motor por defecto + Postgres. */
export const defaultGatewayDeps: GatewayDeps = {
  decide: decideAction,
  approvalsEnabled,

  async record(row) {
    await recordAction({
      userId: row.userId,
      threadId: row.threadId,
      runId: row.runId,
      tool: row.tool,
      kind: row.kind,
      effect: row.effect,
      rule: row.rule,
      reason: row.reason,
      target: row.target,
      args: row.args,
    });
  },

  async createApproval(row) {
    const [created] = await db
      .insert(approvals)
      .values({
        runId: row.runId,
        userId: row.userId,
        tool: row.tool,
        toolCallId: row.toolCallId ?? null,
        // Los argumentos de una aprobación los lee una persona: sin secretos.
        args: redactArgs(row.args) as never,
        rule: row.rule,
        reason: row.reason ?? null,
      })
      .returning({ id: approvals.id });
    return created.id;
  },
};
