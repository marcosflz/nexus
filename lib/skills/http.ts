import { ZodError } from "zod";
import { getCurrentUser, permissionDenied, type SessionUser } from "@/lib/auth";

export async function skillRoute(action: (user: SessionUser) => Promise<Response>): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });
  const denied = permissionDenied(user, "skills");
  if (denied) return denied;
  try { return await action(user); }
  catch (error) { return Response.json({ error: error instanceof ZodError ? error.issues[0]?.message : error instanceof Error ? error.message : "No se pudo completar la operación" }, { status: 400 }); }
}
