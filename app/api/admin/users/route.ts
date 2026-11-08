import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createUser, generatePassword, listUsers } from "@/lib/users";

export const runtime = "nodejs";

const createSchema = z.object({
  email: z.string().regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/),
  /** Si falta, se genera una y se devuelve una sola vez. */
  password: z.string().min(8).max(200).optional(),
  role: z.enum(["admin", "user"]).default("user"),
  canUseClaudeCode: z.boolean().default(false),
});

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ users: await listUsers(), currentUserId: auth.user.id });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Email no válido o contraseña demasiado corta (mínimo 8 caracteres)" },
      { status: 400 },
    );
  }

  const password = parsed.data.password ?? generatePassword();
  const result = await createUser({
    email: parsed.data.email.toLowerCase().trim(),
    password,
    role: parsed.data.role,
    canUseClaudeCode: parsed.data.canUseClaudeCode,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json(
    { user: result.value, generatedPassword: parsed.data.password ? null : password },
    { status: 201 },
  );
}
