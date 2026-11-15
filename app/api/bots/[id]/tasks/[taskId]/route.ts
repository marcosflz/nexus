import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { invalidBody, outcomeError, requireBot } from "@/lib/bots/http";
import { actOnTask, getBotTask, syncTask } from "@/lib/bots/service";
import { isTerminalTask } from "@/lib/bots/spec";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string; taskId: string }> };

async function findTask(id: string, taskId: string) {
  const guard = await requireBot(id);
  if (!guard.ok) return guard;
  const missing = { ok: false as const, response: NextResponse.json({ error: "Tarea no encontrada" }, { status: 404 }) };
  if (!z.string().uuid().safeParse(taskId).success) return missing;
  const task = await getBotTask(guard.value.bot.id, taskId);
  return task ? { ok: true as const, value: task } : missing;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const { id, taskId } = await context.params;
  const found = await findTask(id, taskId);
  if (!found.ok) return found.response;
  // También al terminar: el journal guarda los eventos y el paso que falló.
  const { task, live } = await syncTask(found.value);
  return NextResponse.json({
    task,
    finished: isTerminalTask(task.status),
    failedStep: live?.failedStep ?? null,
    approval: live?.approval ?? null,
    events: live?.events ?? [],
  });
}

const actionSchema = z.object({ action: z.enum(["cancel", "approve", "deny"]) });

export async function POST(req: NextRequest, context: RouteContext) {
  const { id, taskId } = await context.params;
  const found = await findTask(id, taskId);
  if (!found.ok) return found.response;
  const parsed = actionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return invalidBody(parsed.error);
  const result = await actOnTask(found.value, parsed.data.action);
  if (!result.ok) return outcomeError(result);
  return NextResponse.json({ task: result.value });
}
