import { NextRequest } from "next/server";
import { z } from "zod";
import { requireBot } from "@/lib/bots/http";
import { MAX_UPLOAD_BYTES } from "@/lib/extract";
import { deleteKnowledgeFile, indexKnowledgeFile, listKnowledgeFiles } from "@/lib/knowledge/service";

export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Context) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  return Response.json({ files: await listKnowledgeFiles(guard.value.bot.id) });
}
export async function POST(req: Request, ctx: Context) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  const form = await req.formData().catch(() => null);
  const files = form?.getAll("files").filter((value): value is File => value instanceof File) ?? [];
  if (!files.length || files.length > 10) return Response.json({ error: "Sube entre 1 y 10 archivos" }, { status: 400 });
  const results = [];
  for (const file of files) {
    results.push({ name: file.name, ...(file.size > MAX_UPLOAD_BYTES ? { ok: false, error: "Supera el límite de 10 MB" } : await indexKnowledgeFile({ ownerId: guard.value.user.id, botId: guard.value.bot.id, file })) });
  }
  return Response.json({ results });
}
export async function DELETE(req: NextRequest, ctx: Context) {
  const guard = await requireBot((await ctx.params).id);
  if (!guard.ok) return guard.response;
  const fileId = z.string().uuid().safeParse(req.nextUrl.searchParams.get("fileId"));
  if (!fileId.success || !await deleteKnowledgeFile(guard.value.bot.id, fileId.data)) return Response.json({ error: "Archivo no encontrado" }, { status: 404 });
  return Response.json({ ok: true });
}
