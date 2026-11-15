import { z } from "zod";
import { requireBot } from "@/lib/bots/http";
import { permissionDenied } from "@/lib/auth";
import { deleteTrigger, listTriggers, setTriggerEnabled } from "@/lib/triggers/service";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; triggerId: string }> };
async function target(ctx: Context) {
  const { id, triggerId } = await ctx.params;
  const guard = await requireBot(id);
  if (!guard.ok) return { response: guard.response };
  const denied = permissionDenied(guard.value.user, "routines");
  if (denied) return { response: denied };
  if (!(await listTriggers(guard.value.user.id, id)).some((item) => item.id === triggerId)) return { response: Response.json({ error: "Disparador no encontrado" }, { status: 404 }) };
  return { userId: guard.value.user.id, triggerId };
}
export async function PATCH(req: Request, ctx: Context) {
  const checked = await target(ctx);
  if (checked.response) return checked.response;
  const input = z.object({ enabled: z.boolean() }).safeParse(await req.json());
  if (!input.success) return Response.json({ error: "Petición no válida" }, { status: 400 });
  await setTriggerEnabled(checked.userId!, checked.triggerId!, input.data.enabled);
  return Response.json({ ok: true });
}
export async function DELETE(_req: Request, ctx: Context) {
  const checked = await target(ctx);
  if (checked.response) return checked.response;
  await deleteTrigger(checked.userId!, checked.triggerId!);
  return Response.json({ ok: true });
}
