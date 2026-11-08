import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createConnector, listConnectors } from "@/lib/connectors/store";

export const runtime = "nodejs";

const bodySchema = z.object({
  name: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "Usa letras, números, guion y guion bajo (máx. 32)"),
  url: z.string().max(500),
  transport: z.enum(["streamable-http", "sse"]).default("streamable-http"),
  authType: z.enum(["none", "bearer", "header"]).default("none"),
  headerName: z.string().max(64).optional(),
  secret: z.string().max(2000).optional(),
  allowedTools: z.array(z.string().max(120)).max(100).optional(),
});

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ connectors: await listConnectors(user.id) });
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Petición no válida" }, { status: 400 });
  }
  const result = await createConnector(user.id, parsed.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ id: result.id }, { status: 201 });
}
