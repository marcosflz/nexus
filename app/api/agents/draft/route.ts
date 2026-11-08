import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { draftAgentSpec } from "@/lib/agents/draft";
import { loadCredential } from "@/lib/runs/launch";

export const runtime = "nodejs";
export const maxDuration = 90;

const bodySchema = z.object({ description: z.string().trim().min(5).max(4000) });

/** «Describe tu agente»: devuelve un borrador de configuración para revisarlo antes de guardar. */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Describe el agente con al menos unas palabras" }, { status: 400 });
  }
  const credential = await loadCredential(user.id);
  if (!credential.ok) {
    return NextResponse.json({ error: credential.error, code: credential.code }, { status: credential.status });
  }
  const draft = await draftAgentSpec(parsed.data.description, credential.value);
  if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 502 });
  return NextResponse.json({ spec: draft.spec });
}
