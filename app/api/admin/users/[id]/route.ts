import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { deleteUser, generatePassword, updateUser } from "@/lib/users";

export const runtime = "nodejs";

const patchSchema = z
  .object({
    role: z.enum(["admin", "user"]).optional(),
    disabled: z.boolean().optional(),
    canUseClaudeCode: z.boolean().optional(),
    password: z.string().min(8).max(200).optional(),
    /** Genera una contraseña nueva y la devuelve una sola vez. */
    resetPassword: z.literal(true).optional(),
  })
  .refine((value) => Object.keys(value).length > 0);

const idSchema = z.string().uuid();

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const id = idSchema.safeParse((await context.params).id);
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !parsed.success) {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const { resetPassword, ...patch } = parsed.data;
  const generatedPassword = resetPassword ? generatePassword() : null;
  const result = await updateUser(auth.user.id, id.data, {
    ...patch,
    ...(generatedPassword ? { password: generatedPassword } : {}),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ user: result.value, generatedPassword });
}

export async function DELETE(_req: NextRequest, context: RouteContext) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const id = idSchema.safeParse((await context.params).id);
  if (!id.success) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });

  const result = await deleteUser(auth.user.id, id.data);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
