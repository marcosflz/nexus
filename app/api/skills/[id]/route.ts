import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { skills, skillVersions } from "@/lib/db/schema";
import { skillRoute } from "@/lib/skills/http";
import { ownedSkill } from "@/lib/skills/store";

export const runtime = "nodejs";
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  return skillRoute(async (user) => {
    const id = z.string().uuid().parse((await ctx.params).id);
    const skill = await ownedSkill(user.id, id);
    if (!skill) return Response.json({ error: "Skill no encontrada" }, { status: 404 });
    const versions = await db.select().from(skillVersions).where(eq(skillVersions.skillId, id)).orderBy(desc(skillVersions.version));
    return Response.json({ skill, versions });
  });
}
export async function PATCH(req: Request, ctx: Ctx) {
  return skillRoute(async (user) => {
    const id = z.string().uuid().parse((await ctx.params).id);
    const skill = await ownedSkill(user.id, id);
    if (!skill) return Response.json({ error: "Skill no encontrada" }, { status: 404 });
    const patch = z.object({ enabledInChat: z.boolean().optional(), shared: z.boolean().optional(), currentVersionId: z.string().uuid().optional() }).parse(await req.json());
    if (patch.currentVersionId) {
      const [version] = await db.select().from(skillVersions).where(and(eq(skillVersions.skillId, id), eq(skillVersions.id, patch.currentVersionId)));
      if (!version) throw new Error("Versión no encontrada");
    }
    await db.update(skills).set({ enabledInChat: patch.enabledInChat, currentVersionId: patch.currentVersionId,
      galleryVersionId: patch.shared === undefined ? undefined : patch.shared ? (patch.currentVersionId ?? skill.currentVersionId) : null, updatedAt: new Date() }).where(eq(skills.id, id));
    return Response.json({ ok: true });
  });
}
export async function DELETE(_req: Request, ctx: Ctx) {
  return skillRoute(async (user) => {
    const id = z.string().uuid().parse((await ctx.params).id);
    if (!(await ownedSkill(user.id, id))) return Response.json({ error: "Skill no encontrada" }, { status: 404 });
    await db.update(skills).set({ deletedAt: new Date(), galleryVersionId: null, enabledInChat: false }).where(eq(skills.id, id));
    return Response.json({ ok: true });
  });
}
