import { z } from "zod";
import { authenticateInternal } from "@/lib/internal/auth";
import { forget, recall, remember } from "@/lib/memory/store";

export const runtime = "nodejs";

const bodySchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("remember"), key: z.string().min(1).max(200), value: z.string().min(1).max(4000) }),
  z.object({ op: z.literal("recall"), query: z.string().max(200).default("") }),
  z.object({ op: z.literal("forget"), key: z.string().min(1).max(200) }),
]);

/** Memoria del agente que ejecuta el run (o personal, si el run no tiene agente). */
export async function POST(req: Request) {
  const auth = await authenticateInternal(req);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });

  const settings = auth.run.runtimeSnapshot?.spec.memory;
  if (!settings?.enabled || auth.run.runtimeSnapshot?.testId) return Response.json({ error: "Memoria no habilitada en esta ejecución" }, { status: 403 });
  const scope = { userId: auth.run.userId, botId: settings.scope === "user" ? null : auth.run.botId };
  const body = parsed.data;

  if (body.op === "remember") {
    const result = await remember(scope, body.key, body.value);
    return Response.json(result.ok ? { saved: true, key: result.key, updated: result.updated } : { error: result.error });
  }
  if (body.op === "recall") {
    return Response.json({ memories: await recall(scope, body.query) });
  }
  return Response.json({ forgotten: await forget(scope, body.key) });
}
