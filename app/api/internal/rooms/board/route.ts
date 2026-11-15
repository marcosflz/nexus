import { authenticateInternal } from "@/lib/internal/auth";
import { boardOperation, boardOpSchema } from "@/lib/rooms/service";

export const runtime = "nodejs";

/** Tablero de la sala para el bot que ejecuta el run. Solo vale en turnos de sala. */
export async function POST(req: Request) {
  const auth = await authenticateInternal(req);
  if (!auth.ok) return auth.response;
  if (auth.run.initiator !== "room") return Response.json({ error: "Este run no pertenece a ninguna sala" }, { status: 403 });

  const parsed = boardOpSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });
  return Response.json(await boardOperation(auth.run, parsed.data));
}
