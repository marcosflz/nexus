import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { botKnowledgeChunks as knowledgeChunks, botKnowledgeFiles as knowledgeFiles } from "@/lib/db/schema";
import { extractAttachment } from "@/lib/extract";
import { chunkText } from "./chunk";
import { buildOrQuery } from "./query";

export const MAX_KNOWLEDGE_FILES = 50;
export const MAX_KNOWLEDGE_CHARS = 2_000_000;
const MAX_CHUNKS_PER_AGENT = 4000;

export type IndexResult =
  | { ok: true; fileId: string; chunks: number; duplicate: boolean }
  | { ok: false; error: string };

/** Extrae, trocea e indexa un archivo en la base de conocimiento de un Nexbot. */
export async function indexKnowledgeFile(params: {
  ownerId: string;
  botId: string;
  file: File;
}): Promise<IndexResult> {
  const { ownerId, botId, file } = params;
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const [existing] = await db
    .select({ id: knowledgeFiles.id })
    .from(knowledgeFiles)
    .where(and(eq(knowledgeFiles.botId, botId), eq(knowledgeFiles.sha256, sha256)))
    .limit(1);
  if (existing) return { ok: true, fileId: existing.id, chunks: 0, duplicate: true };

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(knowledgeFiles)
    .where(eq(knowledgeFiles.botId, botId));
  if (count >= MAX_KNOWLEDGE_FILES) {
    return { ok: false, error: `Un Nexbot admite como máximo ${MAX_KNOWLEDGE_FILES} archivos` };
  }

  let text: string;
  let name: string;
  let mime: string;
  try {
    const extracted = await extractAttachment(file, { maxChars: MAX_KNOWLEDGE_CHARS });
    ({ text, name, mime } = extracted);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo leer el archivo" };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { ok: false, error: `«${name}» no contiene texto que indexar (¿es un PDF escaneado?)` };
  }
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.botId, botId));
  if (total + chunks.length > MAX_CHUNKS_PER_AGENT) {
    return { ok: false, error: "La base de conocimiento de este Nexbot está llena" };
  }

  const fileId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(knowledgeFiles)
      .values({
        ownerId,
        botId,
        name,
        mime,
        size: bytes.length,
        sha256,
        status: "indexed",
        textChars: text.length,
      })
      .returning({ id: knowledgeFiles.id });
    for (let start = 0; start < chunks.length; start += 200) {
      await tx.insert(knowledgeChunks).values(
        chunks.slice(start, start + 200).map((content, index) => ({
          fileId: row.id,
          botId,
          ordinal: start + index,
          content,
        })),
      );
    }
    return row.id;
  });
  return { ok: true, fileId, chunks: chunks.length, duplicate: false };
}

export interface KnowledgeHit {
  fileId: string;
  name: string;
  ordinal: number;
  content: string;
  rank: number;
}

/** Fragmentos del Nexbot que mejor responden a una pregunta (texto completo, OR + prefijo). */
export async function searchKnowledge(
  botId: string,
  question: string,
  topK: number,
): Promise<KnowledgeHit[]> {
  const query = buildOrQuery(question);
  if (!query) return [];
  const limit = Math.max(1, Math.min(topK, 12));

  const rows = await db.execute<{
    file_id: string;
    name: string;
    ordinal: number;
    content: string;
    rank: number;
  }>(sql`
    SELECT c.file_id, f.name, c.ordinal, c.content, ts_rank_cd(c.tsv, q) AS rank
    FROM bot_knowledge_chunks c
    JOIN bot_knowledge_files f ON f.id = c.file_id
    CROSS JOIN to_tsquery('simple', ${query}) q
    WHERE c.bot_id = ${botId} AND c.tsv @@ q
    ORDER BY rank DESC, c.ordinal
    LIMIT ${limit}`);

  return rows.map((row) => ({
    fileId: row.file_id,
    name: row.name,
    ordinal: row.ordinal,
    content: row.content,
    rank: Number(row.rank),
  }));
}

export async function listKnowledgeFiles(botId: string) {
  return db
    .select({
      id: knowledgeFiles.id,
      name: knowledgeFiles.name,
      size: knowledgeFiles.size,
      status: knowledgeFiles.status,
      textChars: knowledgeFiles.textChars,
      createdAt: knowledgeFiles.createdAt,
    })
    .from(knowledgeFiles)
    .where(eq(knowledgeFiles.botId, botId))
    .orderBy(knowledgeFiles.createdAt);
}

export async function deleteKnowledgeFile(botId: string, fileId: string): Promise<boolean> {
  const removed = await db
    .delete(knowledgeFiles)
    .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.botId, botId)))
    .returning({ id: knowledgeFiles.id });
  return removed.length > 0;
}

/** Texto completo de un archivo, para enseñar la fuente de una cita. */
export async function readKnowledgeFile(botId: string, fileId: string) {
  const [file] = await db
    .select({ name: knowledgeFiles.name })
    .from(knowledgeFiles)
    .where(and(eq(knowledgeFiles.id, fileId), eq(knowledgeFiles.botId, botId)))
    .limit(1);
  if (!file) return null;
  const chunks = await db
    .select({ content: knowledgeChunks.content })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.fileId, fileId))
    .orderBy(knowledgeChunks.ordinal);
  return { name: file.name, text: chunks.map((chunk) => chunk.content).join("\n\n") };
}
