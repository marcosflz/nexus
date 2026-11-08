import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canEditAgent } from "@/lib/agents/access";
import { resolveAgent } from "@/lib/agents/store";
import { MAX_UPLOAD_BYTES } from "@/lib/extract";
import { deleteKnowledgeFile, indexKnowledgeFile, listKnowledgeFiles } from "@/lib/knowledge/service";

export const runtime = "nodejs";
export const maxDuration = 120;

type RouteContext = { params: Promise<{ id: string }> };

async function editableAgent(userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const resolved = await resolveAgent(userId, id);
  return resolved && canEditAgent(userId, resolved.agent) ? resolved : null;
}

export async function GET(_req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!(await editableAgent(user.id, id))) {
    return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ files: await listKnowledgeFiles(id) });
}

/** Sube archivos al conocimiento del agente. Se extraen, trocean e indexan al momento. */
export async function POST(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  if (!(await editableAgent(user.id, id))) {
    return NextResponse.json({ error: "Agente no encontrado" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const files = form?.getAll("files").filter((entry): entry is File => entry instanceof File) ?? [];
  if (files.length === 0) return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
  if (files.length > 10) return NextResponse.json({ error: "Máximo 10 archivos por subida" }, { status: 400 });

  const results = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      results.push({ name: file.name, ok: false, error: "Supera el límite de 10 MB" });
      continue;
    }
    const outcome = await indexKnowledgeFile({ ownerId: user.id, agentId: id, file });
    results.push({ name: file.name, ...outcome });
  }
  return NextResponse.json({ results });
}

export async function DELETE(req: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  const fileId = req.nextUrl.searchParams.get("fileId") ?? "";
  if (!(await editableAgent(user.id, id)) || !z.string().uuid().safeParse(fileId).success) {
    return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  }
  if (!(await deleteKnowledgeFile(id, fileId))) {
    return NextResponse.json({ error: "Archivo no encontrado" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
