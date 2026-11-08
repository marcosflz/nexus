import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { publicTrigger } from "@/lib/triggers/public";
import { createTrigger, listTriggers } from "@/lib/triggers/service";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  kind: z.enum(["cron", "webhook", "rss", "watch", "agent_completed"]),
  name: z.string().max(80).optional(),
  prompt: z.string().max(4000).optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Agente no válido" }, { status: 400 });
  return NextResponse.json({ triggers: (await listTriggers(user.id, id)).map(publicTrigger) });
}

export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const result = await createTrigger(user.id, id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const base = process.env.APP_URL?.replace(/\/$/, "") ?? "";
  return NextResponse.json(
    {
      trigger: publicTrigger(result.trigger),
      // El token solo se muestra ahora: en la base de datos queda su hash.
      webhookUrl: result.webhookToken ? `${base}/api/hooks/${id}/${result.webhookToken}` : undefined,
    },
    { status: 201 },
  );
}
