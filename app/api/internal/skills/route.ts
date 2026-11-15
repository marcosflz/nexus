import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { approvals, skillTests } from "@/lib/db/schema";
import { authenticateInternal } from "@/lib/internal/auth";
import { ownedDraft, skillVersion, updateDraftFiles } from "@/lib/skills/store";
import { botApi } from "@/lib/bots/client";
import { getOwnedBot } from "@/lib/bots/service";
import { hasPermission } from "@/lib/access";
import { getUserAccess } from "@/lib/users";

export const runtime = "nodejs";
export const maxDuration = 60;
const input = z.object({ op: z.enum(["load", "execute", "read_draft", "write_draft_file", "delete_draft_file"]), id: z.string().uuid().optional(), path: z.string().max(512).optional(), content: z.string().max(1_000_000).optional(), args: z.array(z.string().max(16_000)).max(100).optional() });

export async function POST(req: Request) {
  const auth = await authenticateInternal(req);
  if (!auth.ok) return auth.response;
  try {
    const body = input.parse(await req.json());
    const snapshot = auth.run.runtimeSnapshot;
    if (!snapshot) return Response.json({ error: "La ejecución no tiene catálogo fijado" }, { status: 403 });
    const owner = await getUserAccess(auth.run.userId);
    if (!owner || owner.disabled || !hasPermission(owner, "skills")) return Response.json({ error: "Skills no permitidas" }, { status: 403 });
    if (body.op.endsWith("draft") || body.op.endsWith("draft_file")) {
      if (!snapshot.creatorDraftId) return Response.json({ error: "Este run no puede editar borradores" }, { status: 403 });
      const draft = await ownedDraft(auth.run.userId, snapshot.creatorDraftId);
      if (!draft || draft.threadId !== auth.run.threadId) return Response.json({ error: "Borrador no encontrado" }, { status: 404 });
      if (body.op === "read_draft") return Response.json({ files: draft.files, revision: draft.revision });
      const path = body.path ?? "";
      if (!path || path.startsWith("/") || path.includes("\\") || path.includes("\0") || path.includes(":") || path.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Ruta de archivo no válida");
      const files = { ...draft.files };
      if (body.op === "delete_draft_file") delete files[path];
      else files[path] = Buffer.from(body.content ?? "", "utf8").toString("base64");
      const updated = await updateDraftFiles(auth.run.userId, draft.id, files, draft.revision);
      return Response.json({ saved: true, revision: updated.revision });
    }
    const ref = snapshot.skills.find((item) => item.id === body.id);
    if (!ref) return Response.json({ error: "Skill fuera del catálogo autorizado" }, { status: 403 });
    const version = await skillVersion(auth.run.userId, ref.id);
    const [test] = !version && snapshot.testId === ref.id ? await db.select().from(skillTests).where(and(eq(skillTests.id, ref.id), eq(skillTests.ownerId, auth.run.userId))) : [];
    const pack = version?.package ?? test?.package;
    if (!pack || pack.digest !== ref.digest) return Response.json({ error: "La versión fijada no está disponible" }, { status: 409 });
    if (body.op === "load") return Response.json({ package: pack });
    const bot = auth.run.botId ? await getOwnedBot(auth.run.userId, auth.run.botId) : null;
    if (!snapshot.scripts || !bot?.environmentEnabled || bot.status !== "running" || !hasPermission(owner, "bots") || !hasPermission(owner, "computer")) return Response.json({ error: "La ejecución necesita un Nexbot con entorno autorizado" }, { status: 403 });
    if (!body.path?.startsWith("scripts/") || !(body.path in pack.files)) throw new Error("Script no encontrado en la versión fijada");
    const approved = await db.select({ args: approvals.args }).from(approvals).where(and(eq(approvals.runId, auth.run.id), eq(approvals.status, "approved"), eq(approvals.tool, "run_skill_script")));
    if (!approved.some(({ args }) => {
      const value = args as { skill?: string; path?: string; args?: string[] };
      return (value.skill === ref.id || value.skill === ref.name) && value.path === body.path && JSON.stringify(value.args ?? []) === JSON.stringify(body.args ?? []);
    })) return Response.json({ error: "El script requiere aprobación" }, { status: 403 });
    const result = await botApi(bot.id, "POST", "skills/run", { runId: auth.run.id, package: pack, path: body.path, args: body.args ?? [], timeoutS: Math.min(20, Number(bot.config.taskTimeoutS) || 20) });
    return result.ok ? Response.json(result.data) : Response.json({ error: result.error }, { status: result.status });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Operación no válida" }, { status: 400 });
  }
}
