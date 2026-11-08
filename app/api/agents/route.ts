import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createAgent, listAgentsFor } from "@/lib/agents/store";
import { agentSpecSchema } from "@/lib/agents/spec";

export const runtime = "nodejs";

const createSchema = z.object({
  spec: z.unknown(),
  description: z.string().max(500).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const rows = await listAgentsFor(user.id);
  return NextResponse.json({
    agents: rows.map((agent) => ({
      id: agent.id,
      slug: agent.slug,
      name: agent.name,
      avatar: agent.avatar,
      description: agent.description,
      visibility: agent.visibility,
      status: agent.status,
      mine: agent.mine,
      updatedAt: agent.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const body = createSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });

  const spec = agentSpecSchema.safeParse(body.data.spec);
  if (!spec.success) {
    return NextResponse.json(
      { error: "El agente no es válido", issues: spec.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }
  const created = await createAgent(user.id, spec.data, {
    description: body.data.description,
    visibility: body.data.visibility,
  });
  return NextResponse.json({ agent: created.agent, spec: created.spec, version: created.version }, { status: 201 });
}
