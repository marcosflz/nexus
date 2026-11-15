import { z } from "zod";
import { authenticateInternal } from "@/lib/internal/auth";
import { validateOpenUiProgram } from "@/lib/openui/validate";

export const runtime = "nodejs";

const bodySchema = z.object({ ui: z.string().max(100_000) });

/** Valida un programa OpenUI antes de que el modelo lo dé por entregado. */
export async function POST(req: Request) {
  const auth = await authenticateInternal(req);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });

  const result = validateOpenUiProgram(parsed.data.ui);
  return Response.json({ ok: result.ok, error: result.error ?? null, warnings: result.warnings });
}
