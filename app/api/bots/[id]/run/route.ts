import { z } from "zod";
import { requireBot } from "@/lib/bots/http";
import { launchRoutineRun } from "@/lib/runs/routine";

export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  const input = z.object({ prompt: z.string().trim().min(1).max(20_000) }).safeParse(await req.json());
  if (!input.success) return Response.json({ error: "Indica una tarea" }, { status: 400 });
  const result = await launchRoutineRun({ botId: guard.value.bot.id, ownerId: guard.value.user.id, prompt: input.data.prompt, source: "manual", manual: true });
  return Response.json(result, { status: result.ok ? 202 : 400 });
}
