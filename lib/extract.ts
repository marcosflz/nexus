import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENT_CHARS = 100_000;

const TEXT_EXTENSIONS = [".txt", ".md", ".markdown", ".csv", ".json", ".log"];

export interface ExtractedAttachment {
  name: string;
  mime: string;
  size: number;
  text: string;
  truncated: boolean;
}

export async function extractAttachment(
  file: File,
  options: { maxChars?: number } = {},
): Promise<ExtractedAttachment> {
  const maxChars = options.maxChars ?? MAX_ATTACHMENT_CHARS;
  const name = file.name.slice(0, 200);
  const lower = name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  let raw: string;
  if (lower.endsWith(".pdf")) {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const result = await extractText(pdf, { mergePages: true });
    raw = Array.isArray(result.text) ? result.text.join("\n\n") : result.text;
  } else if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    raw = result.value;
  } else if (
    TEXT_EXTENSIONS.some((extension) => lower.endsWith(extension)) ||
    file.type.startsWith("text/")
  ) {
    raw = buffer.toString("utf8");
  } else {
    throw new Error(
      `Formato no soportado (${file.type || name}). Soportados: PDF, DOCX, TXT, MD, CSV, JSON.`,
    );
  }

  const normalized = raw.replace(/\u0000/g, "").trim();
  const truncated = normalized.length > maxChars;

  return {
    name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    text: normalized.slice(0, maxChars),
    truncated,
  };
}
