import { z } from "zod";
import { skillRoute } from "@/lib/skills/http";
import { draftDetail, ownedDraft, updateDraftFiles } from "@/lib/skills/store";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  return skillRoute(async (user) => {
    const detail = await draftDetail(user.id, (await ctx.params).id);
    return detail ? Response.json(detail) : Response.json({ error: "Borrador no encontrado" }, { status: 404 });
  });
}
export async function PATCH(req: Request, ctx: Ctx) {
  return skillRoute(async (user) => {
    const id = (await ctx.params).id;
    if (!(await ownedDraft(user.id, id))) return Response.json({ error: "Borrador no encontrado" }, { status: 404 });
    const input = z.object({ files: z.record(z.string(), z.string()), revision: z.number().int().positive() }).parse(await req.json());
    return Response.json({ draft: await updateDraftFiles(user.id, id, input.files, input.revision) });
  });
}
