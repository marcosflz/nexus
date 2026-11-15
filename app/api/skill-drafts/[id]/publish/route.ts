import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { skillDrafts } from "@/lib/db/schema";
import { skillRoute } from "@/lib/skills/http";
import { ownedDraft, publishPackage } from "@/lib/skills/store";
import { validateSkillFiles } from "@/lib/skills/sidecar";

export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return skillRoute(async (user) => {
    const draft = await ownedDraft(user.id, (await ctx.params).id);
    if (!draft) return Response.json({ error: "Borrador no encontrado" }, { status: 404 });
    const input = z.object({ revision: z.number().int().positive() }).parse(await req.json());
    if (input.revision !== draft.revision) throw new Error("El borrador ha cambiado. Revisa la versión actual antes de publicar.");
    const pack = await validateSkillFiles(draft.files);
    const result = await publishPackage(user.id, pack, { skillId: draft.skillId ?? undefined, source: draft.source, draft: { id: draft.id, revision: input.revision } });
    return Response.json(result);
  });
}
