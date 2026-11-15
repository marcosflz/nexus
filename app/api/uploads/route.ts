import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, permissionDenied } from "@/lib/auth";
import { extractAttachment, MAX_UPLOAD_BYTES } from "@/lib/extract";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const denied = permissionDenied(user, "attachments");
  if (denied) return denied;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Petición no válida" }, { status: 400 });

  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No se recibió ningún archivo" }, { status: 400 });
  }
  if (files.length > 5) {
    return NextResponse.json({ error: "Máximo 5 archivos por mensaje" }, { status: 400 });
  }

  const attachments = [];
  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `"${file.name}" supera el límite de 10 MB` },
        { status: 400 },
      );
    }
    try {
      attachments.push(await extractAttachment(file));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "No se pudo leer el archivo" },
        { status: 400 },
      );
    }
  }

  return NextResponse.json({ attachments });
}
