import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { getCurrentUser, readSessionToken } from "@/lib/auth";
import { hashPassword, hashToken, verifyPassword } from "@/lib/crypto";

export const runtime = "nodejs";

const bodySchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
});

/** Cambia la contraseña propia y cierra el resto de sesiones de la cuenta. */
export async function PATCH(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "La contraseña nueva debe tener al menos 8 caracteres" }, { status: 400 });
  }

  const [row] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
  if (!row || !verifyPassword(parsed.data.currentPassword, row.passwordHash)) {
    return NextResponse.json({ error: "La contraseña actual no es correcta" }, { status: 403 });
  }

  await db.update(users).set({ passwordHash: hashPassword(parsed.data.newPassword) }).where(eq(users.id, user.id));

  const token = readSessionToken(req.cookies);
  await db
    .delete(sessions)
    .where(
      token
        ? and(eq(sessions.userId, user.id), ne(sessions.tokenHash, hashToken(token)))
        : eq(sessions.userId, user.id),
    );
  return NextResponse.json({ ok: true });
}
