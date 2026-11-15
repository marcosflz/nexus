import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, permissionDenied, type SessionUser } from "@/lib/auth";
import { getOwnedBot, type Bot } from "./service";

type Guard<T> = { ok: true; value: T } | { ok: false; response: Response };

export async function requireBotUser(): Promise<Guard<SessionUser>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, response: NextResponse.json({ error: "No autenticado" }, { status: 401 }) };
  const denied = permissionDenied(user, "bots");
  if (denied) return { ok: false, response: denied };
  return { ok: true, value: user };
}

/** Un bot ajeno responde igual que uno inexistente: no se revela que existe. */
export async function requireBot(id: string): Promise<Guard<{ user: SessionUser; bot: Bot }>> {
  const user = await requireBotUser();
  if (!user.ok) return user;
  const notFound = { ok: false as const, response: NextResponse.json({ error: "Bot no encontrado" }, { status: 404 }) };
  if (!z.string().uuid().safeParse(id).success) return notFound;
  const bot = await getOwnedBot(user.value.id, id);
  return bot ? { ok: true, value: { user: user.value, bot } } : notFound;
}

export const outcomeError = (result: { status: number; error: string }) =>
  NextResponse.json({ error: result.error }, { status: result.status });

export const invalidBody = (error: z.ZodError) =>
  NextResponse.json({ error: error.issues[0]?.message ?? "Petición no válida" }, { status: 400 });
