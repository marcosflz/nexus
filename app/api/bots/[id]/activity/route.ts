import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { requireBot } from "@/lib/bots/http";
import { db } from "@/lib/db";
import { messages, runs } from "@/lib/db/schema";

export const runtime = "nodejs";

/** Últimos runs que han corrido en este bot, con lo que hicieron. Los que siguen en marcha se siguen en directo. */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const guard = await requireBot((await context.params).id);
  if (!guard.ok) return guard.response;
  const recent = await db
    .select({ id: runs.id, status: runs.status, initiator: runs.initiator, prompt: runs.prompt, error: runs.error, createdAt: runs.createdAt })
    .from(runs)
    .where(eq(runs.botId, guard.value.bot.id))
    .orderBy(desc(runs.createdAt))
    .limit(8);
  const answers = recent.length
    ? await db
        .select({ runId: messages.runId, content: messages.content, tools: messages.tools, reasoning: messages.reasoning })
        .from(messages)
        .where(inArray(messages.runId, recent.map((run) => run.id)))
    : [];
  return NextResponse.json({
    runs: recent.map((run) => {
      const answer = answers.find((row) => row.runId === run.id && row.content !== undefined);
      return { ...run, prompt: (run.prompt ?? "").slice(0, 400), content: answer?.content ?? null, tools: answer?.tools ?? [], reasoning: answer?.reasoning ?? null };
    }),
  });
}
