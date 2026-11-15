import { z } from "zod";
import { requireBot } from "@/lib/bots/http";
import { permissionDenied } from "@/lib/auth";
import { createTrigger, listTriggers } from "@/lib/triggers/service";
import { publicTrigger } from "@/lib/triggers/public";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Context) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  return Response.json({ triggers: (await listTriggers(guard.value.user.id, guard.value.bot.id)).map(publicTrigger) });
}
export async function POST(req: Request, ctx: Context) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  const denied = permissionDenied(guard.value.user, "routines");
  if (denied) return denied;
  const input = z.object({ kind: z.enum(["cron", "webhook", "rss", "watch", "bot_completed"]), name: z.string().max(80).optional(), prompt: z.string().max(4000).optional(), config: z.record(z.string(), z.unknown()).default({}) }).safeParse(await req.json());
  if (!input.success) return Response.json({ error: "Disparador no válido" }, { status: 400 });
  const result = await createTrigger(guard.value.user.id, guard.value.bot.id, input.data);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });
  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  return Response.json({ trigger: publicTrigger(result.trigger), webhookUrl: result.webhookToken ? `${base}/api/hooks/${guard.value.bot.id}/${result.webhookToken}` : undefined }, { status: 201 });
}
