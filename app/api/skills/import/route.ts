import { z } from "zod";
import { skillRoute } from "@/lib/skills/http";
import { skillOperation } from "@/lib/skills/sidecar";
import { createSkillDraft } from "@/lib/skills/store";

export const runtime = "nodejs";
export const maxDuration = 120;
const input = z.object({ url: z.string().url().optional(), archive: z.string().max(14_000_000).optional(), package: z.unknown().optional(), install: z.boolean().default(false), skillId: z.string().uuid().optional(), source: z.record(z.string(), z.unknown()).optional() });

export async function POST(req: Request) {
  return skillRoute(async (user) => {
    const data = input.parse(await req.json());
    const result = await skillOperation({ op: data.url ? "github" : "inspect", url: data.url, archive: data.archive, package: data.package });
    if (!data.install) return Response.json(result);
    if (result.packages?.length !== 1) throw new Error("Selecciona una skill antes de importarla");
    const draft = await createSkillDraft(user.id, data.skillId, result.packages[0].files, data.source);
    return Response.json({ draft }, { status: 201 });
  });
}
