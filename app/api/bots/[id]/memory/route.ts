import { z } from "zod";
import { requireBot } from "@/lib/bots/http";
import { runtimeOfBot } from "@/lib/bots/profile";
import { forget, recall } from "@/lib/memory/store";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  const { user, bot } = guard.value;
  return Response.json({ memories: await recall({ userId: user.id, botId: runtimeOfBot(bot).memory.scope === "user" ? null : bot.id }, "", 200) });
}
export async function DELETE(req: Request, ctx: Ctx) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  const input = z.object({ key: z.string().min(1).max(200) }).safeParse(await req.json());
  if (!input.success) return Response.json({ error: "Clave no válida" }, { status: 400 });
  const { user, bot } = guard.value;
  return Response.json({ forgotten: await forget({ userId: user.id, botId: runtimeOfBot(bot).memory.scope === "user" ? null : bot.id }, input.data.key) });
}
