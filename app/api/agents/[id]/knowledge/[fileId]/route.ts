import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canEditAgent } from "@/lib/agents/access";
import { resolveAgent } from "@/lib/agents/store";
import { readKnowledgeFile } from "@/lib/knowledge/service";

export const runtime = "nodejs";

/**
 * Texto de un documento de conocimiento: es el destino de las citas del agente.
 * Solo lo ve quien edita el agente: el contenido de un agente público no se
 * expone a quienes solo lo usan.
 */
export async function GET(_req: Request, context: { params: Promise<{ id: string; fileId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("No autenticado", { status: 401 });
  const { id, fileId } = await context.params;
  const uuid = z.string().uuid();
  if (!uuid.safeParse(id).success || !uuid.safeParse(fileId).success) {
    return new Response("No encontrado", { status: 404 });
  }

  const resolved = await resolveAgent(user.id, id);
  if (!resolved || !canEditAgent(user.id, resolved.agent)) {
    return new Response("No encontrado", { status: 404 });
  }
  const file = await readKnowledgeFile(id, fileId);
  if (!file) return new Response("No encontrado", { status: 404 });
  return new Response(`${file.name}\n\n${file.text}`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" },
  });
}
