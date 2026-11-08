import { parseMention } from "./slug";
import { resolveAgent, resolveBySlug, type ResolvedAgent } from "./store";

export type AgentSelection =
  | { ok: true; agent: ResolvedAgent | null; text: string; explicit: boolean }
  | { ok: false; status: number; error: string };

/**
 * Qué agente atiende un turno. Precedencia: `@mención` al inicio del mensaje,
 * agente elegido explícitamente en la petición, agente del hilo y, si no hay
 * ninguno, el integrado de Nexus (`agent: null`).
 */
export async function selectAgent(
  userId: string,
  input: { text: string; explicitId?: string | null; threadAgentId?: string | null },
): Promise<AgentSelection> {
  const mention = parseMention(input.text);
  if (mention) {
    const agent = await resolveBySlug(userId, mention.slug);
    if (!agent) {
      return { ok: false, status: 404, error: `No existe el agente @${mention.slug}` };
    }
    // Un mensaje que solo es la mención no tiene qué preguntar.
    const text = mention.rest || input.text;
    return { ok: true, agent, text, explicit: true };
  }

  const id = input.explicitId ?? input.threadAgentId ?? null;
  if (!id) return { ok: true, agent: null, text: input.text, explicit: false };

  const agent = await resolveAgent(userId, id);
  if (!agent) {
    // El agente del hilo pudo borrarse o dejar de ser público: se avisa, no se sustituye.
    return { ok: false, status: 404, error: "El agente de este chat ya no está disponible" };
  }
  return { ok: true, agent, text: input.text, explicit: input.explicitId != null };
}
