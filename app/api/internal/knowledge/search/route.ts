import { z } from "zod";
import { authenticateInternal } from "@/lib/internal/auth";
import { searchKnowledge } from "@/lib/knowledge/service";

export const runtime = "nodejs";

const bodySchema = z.object({ query: z.string().min(1).max(500), topK: z.number().int().min(1).max(12).default(6) });

/** El sidecar busca aquí en el conocimiento del agente que ejecuta el run. */
export async function POST(req: Request) {
  const auth = await authenticateInternal(req);
  if (!auth.ok) return auth.response;
  const agentId = auth.run.botId;
  if (!agentId || !auth.run.runtimeSnapshot?.spec.knowledge.enabled) return Response.json({ results: [] });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });

  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  const hits = await searchKnowledge(agentId, parsed.data.query, parsed.data.topK);
  return Response.json({
    results: hits.map((hit) => ({
      fileId: hit.fileId,
      name: hit.name,
      ordinal: hit.ordinal,
      content: hit.content,
      url: `${base}/api/bots/${agentId}/knowledge/${hit.fileId}`,
    })),
  });
}
