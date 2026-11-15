import { z } from "zod";
import { skillRoute } from "@/lib/skills/http";
import { launchSkillTest } from "@/lib/skills/runs";

export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return skillRoute(async (user) => {
    const input = z.object({ input: z.string().trim().min(1).max(8000), expected: z.string().max(4000).default(""), botId: z.string().uuid().optional() }).parse(await req.json());
    return Response.json(await launchSkillTest(user.id, (await ctx.params).id, input.input, input.expected, input.botId), { status: 202 });
  });
}
