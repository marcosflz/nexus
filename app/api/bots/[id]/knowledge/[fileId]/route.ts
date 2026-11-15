import { z } from "zod";
import { requireBot } from "@/lib/bots/http";
import { readKnowledgeFile } from "@/lib/knowledge/service";

export const runtime = "nodejs";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; fileId: string }> }) {
  const { id, fileId } = await ctx.params;
  const guard = await requireBot(id);
  if (!guard.ok) return guard.response;
  const valid = z.string().uuid().safeParse(fileId);
  const file = valid.success ? await readKnowledgeFile(id, fileId) : null;
  return file ? new Response(`${file.name}\n\n${file.text}`, { headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" } }) : new Response("No encontrado", { status: 404 });
}
