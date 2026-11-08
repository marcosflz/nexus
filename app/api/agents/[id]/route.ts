import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canEditAgent } from "@/lib/agents/access";
import { agentSpecSchema } from "@/lib/agents/spec";
import { deleteAgent, publishVersion, resolveAgent, updateAgentMeta } from "@/lib/agents/store";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  /** Un spec nuevo publica una versión nueva. */
  spec: z.unknown().optional(),
  description: z.string().max(500).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

const idOk = (id: string) => z.string().uuid().safeParse(id).success;

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!idOk(id)) return NextResponse.json({ error: "Agente no válido" }, { status: 400 });

  const resolved = await resolveAgent(user.id, id);
  if (!resolved) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  return NextResponse.json({
    agent: resolved.agent,
    spec: resolved.spec,
    version: resolved.version,
    canEdit: canEditAgent(user.id, resolved.agent),
  });
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!idOk(id)) return NextResponse.json({ error: "Agente no válido" }, { status: 400 });

  const body = patchSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });

  const { spec: rawSpec, ...meta } = body.data;
  if (Object.keys(meta).length > 0) {
    const updated = await updateAgentMeta(user.id, id, meta);
    if (!updated) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  }
  if (rawSpec !== undefined) {
    const spec = agentSpecSchema.safeParse(rawSpec);
    if (!spec.success) {
      return NextResponse.json(
        { error: "El agente no es válido", issues: spec.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
        { status: 400 },
      );
    }
    const published = await publishVersion(user.id, id, spec.data);
    if (!published) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
    return NextResponse.json({ ok: true, version: published.version });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!idOk(id) || !(await deleteAgent(user.id, id))) {
    return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
