import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { skills, skillVersions } from "@/lib/db/schema";
import { skillRoute } from "@/lib/skills/http";
import { publishPackage } from "@/lib/skills/store";

export const runtime = "nodejs";
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return skillRoute(async (user) => {
    const [row] = await db.select({ package: skillVersions.package, id: skillVersions.id }).from(skills)
      .innerJoin(skillVersions, eq(skills.galleryVersionId, skillVersions.id))
      .where(and(eq(skills.id, (await ctx.params).id), isNull(skills.deletedAt)));
    if (!row) return Response.json({ error: "Skill no encontrada en la galería" }, { status: 404 });
    return Response.json(await publishPackage(user.id, row.package, { source: { galleryVersionId: row.id } }), { status: 201 });
  });
}
