import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { revokeSessions } from "@/lib/users";

export const runtime = "nodejs";

/** `?session=<id>` cierra una sola; sin él, todas las de la cuenta. */
export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const id = z.string().uuid().safeParse((await context.params).id);
  const raw = req.nextUrl.searchParams.get("session");
  const session = raw === null ? null : z.string().regex(/^[0-9a-f]{16}$/).safeParse(raw);
  if (!id.success || (session && !session.success)) {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const result = await revokeSessions(auth.user, id.data, session?.data ?? null);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(result.value);
}
