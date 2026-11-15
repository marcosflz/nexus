import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { skillDrafts } from "@/lib/db/schema";
import { skillRoute } from "@/lib/skills/http";
import { createSkillDraft } from "@/lib/skills/store";

export const runtime = "nodejs";
export async function GET() {
  return skillRoute(async (user) => Response.json({ drafts: await db.select({ id: skillDrafts.id, skillId: skillDrafts.skillId, updatedAt: skillDrafts.updatedAt }).from(skillDrafts).where(eq(skillDrafts.ownerId, user.id)).orderBy(desc(skillDrafts.updatedAt)) }));
}
export async function POST(req: Request) {
  return skillRoute(async (user) => {
    const input = z.object({ skillId: z.string().uuid().optional() }).parse(await req.json());
    return Response.json({ draft: await createSkillDraft(user.id, input.skillId) }, { status: 201 });
  });
}
