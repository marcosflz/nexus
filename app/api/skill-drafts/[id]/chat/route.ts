import { z } from "zod";
import { skillRoute } from "@/lib/skills/http";
import { launchCreator } from "@/lib/skills/runs";

export const runtime = "nodejs";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return skillRoute(async (user) => {
    const input = z.object({ text: z.string().trim().min(1).max(8000) }).parse(await req.json());
    return Response.json(await launchCreator(user.id, (await ctx.params).id, input.text), { status: 202 });
  });
}
