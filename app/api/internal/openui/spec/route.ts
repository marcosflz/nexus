import { z } from "zod";
import { authenticateInternal } from "@/lib/internal/auth";
import { isOpenUiProfile, openUiSpec } from "@/lib/openui/profiles";

export const runtime = "nodejs";

const bodySchema = z.object({ profile: z.string().max(40) });

/** Especificación de componentes de un perfil, para cargarla solo cuando hace falta. */
export async function POST(req: Request) {
  const auth = await authenticateInternal(req);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !isOpenUiProfile(parsed.data.profile)) {
    return Response.json({ error: "Perfil de OpenUI desconocido" }, { status: 400 });
  }
  return Response.json({ spec: openUiSpec(parsed.data.profile) });
}
