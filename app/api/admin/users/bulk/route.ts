import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { revokeSessions, updateUser } from "@/lib/users";

export const runtime = "nodejs";

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(["disable", "enable", "revoke_sessions"]),
});

/** Cada cuenta pasa por las mismas reglas que una a una; las rechazadas se informan. */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });

  const failed: { id: string; error: string }[] = [];
  for (const id of new Set(parsed.data.ids)) {
    const result =
      parsed.data.action === "revoke_sessions"
        ? await revokeSessions(auth.user, id, null)
        : await updateUser(auth.user, id, { disabled: parsed.data.action === "disable" });
    if (!result.ok) failed.push({ id, error: result.error });
  }
  return NextResponse.json({ failed });
}
