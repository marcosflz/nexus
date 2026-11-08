import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canEditAgent } from "@/lib/agents/access";
import { resolveAgent } from "@/lib/agents/store";
import { isHumanInControl, setHumanControl } from "@/lib/sandbox/control";
import { sandboxAvailable } from "@/lib/sandbox/client";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

async function ownedAgent(userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const resolved = await resolveAgent(userId, id);
  return resolved && canEditAgent(userId, resolved.agent) ? resolved : null;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!(await ownedAgent(user.id, id))) return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  return NextResponse.json({ available: sandboxAvailable(), humanControl: await isHumanInControl(id) });
}

/** «Tomar el control»: mientras está activo, el agente no puede usar su navegador. */
export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  const parsed = z.object({ control: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !(await ownedAgent(user.id, id))) {
    return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  }
  await setHumanControl(id, parsed.data.control);
  return NextResponse.json({ humanControl: parsed.data.control });
}
