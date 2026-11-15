import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { bots as agents, botTriggers as agentTriggers } from "@/lib/db/schema";
import { MAX_HOOK_BODY_BYTES, RateLimiter, verifyHookToken, wrapUntrusted } from "@/lib/triggers/hooks";
import { enqueueJob } from "@/lib/worker/jobs";

export const runtime = "nodejs";

// Por IP (frena el barrido de tokens) y por agente (frena un emisor desbocado).
const perIp = new RateLimiter(60, 60_000);
const perAgent = new RateLimiter(10, 60_000);

type RouteContext = { params: Promise<{ agentId: string; token: string }> };

/** Lee el cuerpo con tope duro: no se confía en Content-Length. */
async function readLimited(req: NextRequest): Promise<string | null> {
  const reader = req.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HOOK_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Endpoint público que dispara un agente. La autenticación es el propio token
 * de la URL. Cualquier fallo responde 404 sin distinguir «el agente no existe»
 * de «el token es incorrecto», para no revelar qué agentes hay.
 */
export async function POST(req: NextRequest, context: RouteContext) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconocida";
  if (!perIp.allow(ip)) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });

  const { agentId, token } = await context.params;
  const notFound = () => NextResponse.json({ error: "No encontrado" }, { status: 404 });
  if (!z.string().uuid().safeParse(agentId).success || token.length < 20 || token.length > 200) return notFound();

  const triggers = await db
    .select({ trigger: agentTriggers, status: agents.status })
    .from(agentTriggers)
    .innerJoin(agents, eq(agents.id, agentTriggers.botId))
    .where(
      and(eq(agentTriggers.botId, agentId), eq(agentTriggers.kind, "webhook"), eq(agentTriggers.enabled, true)),
    );
  const match = triggers.find(({ trigger }) => {
    const hash = (trigger.config as { tokenHash?: string }).tokenHash;
    return hash ? verifyHookToken(token, hash) : false;
  });
  if (!match || match.status === "error") return notFound();

  if (!perAgent.allow(agentId)) return NextResponse.json({ error: "Demasiadas peticiones" }, { status: 429 });

  const body = await readLimited(req);
  if (body === null) return NextResponse.json({ error: "Cuerpo demasiado grande" }, { status: 413 });

  await enqueueJob({
    kind: "bot_run",
    payload: {
      botId: agentId,
      triggerId: match.trigger.id,
      prompt: match.trigger.prompt || "Ha llegado un evento por webhook. Analízalo y actúa según tus instrucciones.",
      context: wrapUntrusted("webhook", body),
      source: match.trigger.name || "webhook",
    },
  });
  return NextResponse.json({ queued: true }, { status: 202 });
}
