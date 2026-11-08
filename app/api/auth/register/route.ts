import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSession, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth";
import { createFirstAdmin } from "@/lib/users";

export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Email no válido"),
  password: z.string().min(8).max(200),
});

/**
 * No hay registro libre: esta ruta solo crea la primera cuenta de la instancia,
 * que nace como admin. Las demás las crea un admin desde Ajustes → Usuarios.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Email no válido o contraseña demasiado corta (mínimo 8 caracteres)" },
      { status: 400 },
    );
  }

  const user = await createFirstAdmin(parsed.data.email.toLowerCase().trim(), parsed.data.password);
  if (!user) {
    return NextResponse.json(
      { error: "El registro está cerrado. Pide a un administrador que te cree una cuenta." },
      { status: 403 },
    );
  }

  const { token, expiresAt } = await createSession(user.id);
  const res = NextResponse.json({ user }, { status: 201 });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req, expiresAt));
  return res;
}
