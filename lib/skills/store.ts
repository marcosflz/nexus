import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, runs, skillDrafts, skills, skillTests, skillVersions, threads } from "@/lib/db/schema";
import type { SkillPackage, SkillRef } from "./contracts.generated";
import { skillOperation } from "./sidecar";

export async function ownedSkill(userId: string, id: string) {
  const [row] = await db.select().from(skills).where(and(eq(skills.id, id), eq(skills.ownerId, userId), isNull(skills.deletedAt))).limit(1);
  return row ?? null;
}

export async function skillLibrary(userId: string) {
  return db.select().from(skills).where(and(eq(skills.ownerId, userId), isNull(skills.deletedAt))).orderBy(desc(skills.updatedAt));
}

export async function skillGallery() {
  return db.select({ id: skills.id, name: skills.name, description: skills.description, versionId: skills.galleryVersionId })
    .from(skills).where(and(isNull(skills.deletedAt), sql`${skills.galleryVersionId} IS NOT NULL`)).orderBy(skills.name);
}

export async function skillVersion(userId: string, id: string) {
  const [row] = await db.select({ version: skillVersions }).from(skillVersions)
    .innerJoin(skills, eq(skills.id, skillVersions.skillId))
    .where(and(eq(skillVersions.id, id), eq(skills.ownerId, userId))).limit(1);
  return row?.version ?? null;
}

export function packageRef(id: string, pack: SkillPackage): SkillRef {
  return { id, name: pack.manifest.name, description: pack.manifest.description, digest: pack.digest };
}

export async function catalogFor(userId: string, assigned?: string[]): Promise<SkillRef[]> {
  if (assigned?.length === 0) return [];
  const rows = await db.select({ id: skillVersions.id, package: skillVersions.package }).from(skills)
    .innerJoin(skillVersions, eq(skillVersions.id, skills.currentVersionId))
    .where(and(eq(skills.ownerId, userId), isNull(skills.deletedAt), assigned
      ? inArray(skills.id, assigned) : eq(skills.enabledInChat, true))).orderBy(skills.name);
  return rows.map((row) => packageRef(row.id, row.package));
}

export async function checkSkillAssignments(userId: string, ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new Error("Hay skills repetidas");
  if (!ids.length) return;
  const rows = await db.select({ id: skills.id }).from(skills).where(and(eq(skills.ownerId, userId), inArray(skills.id, ids), isNull(skills.deletedAt)));
  if (rows.length !== ids.length) throw new Error("Solo puedes asignar skills de tu biblioteca");
}

export async function publishPackage(userId: string, pack: SkillPackage, options: { skillId?: string; source?: Record<string, unknown>; draft?: { id: string; revision: number } } = {}) {
  return db.transaction(async (tx) => {
    // Serializes same-owner imports, names and version numbering without a global lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
    if (options.draft) {
      const [draft] = await tx.select().from(skillDrafts).where(and(eq(skillDrafts.id, options.draft.id), eq(skillDrafts.ownerId, userId))).for("update");
      if (!draft || draft.revision !== options.draft.revision) throw new Error("El borrador ha cambiado. Revísalo antes de publicar.");
    }
    let row = options.skillId ? (await tx.select().from(skills).where(and(eq(skills.id, options.skillId), eq(skills.ownerId, userId), isNull(skills.deletedAt))).for("update"))[0] : null;
    if (options.skillId && !row) throw new Error("Skill no encontrada");
    const [collision] = await tx.select({ id: skills.id }).from(skills).where(and(eq(skills.ownerId, userId), eq(skills.name, pack.manifest.name), isNull(skills.deletedAt)));
    if (collision && collision.id !== row?.id) throw new Error("Ya tienes una skill con ese nombre. Edita su borrador para actualizarla.");
    if (!row) [row] = await tx.insert(skills).values({ ownerId: userId, name: pack.manifest.name, description: pack.manifest.description, source: options.source ?? {} }).returning();
    const [{ latest }] = await tx.select({ latest: sql<number>`coalesce(max(${skillVersions.version}), 0)::int` }).from(skillVersions).where(eq(skillVersions.skillId, row.id));
    const [version] = await tx.insert(skillVersions).values({ skillId: row.id, version: latest + 1, package: pack }).returning();
    const [updated] = await tx.update(skills).set({ name: pack.manifest.name, description: pack.manifest.description, currentVersionId: version.id, updatedAt: new Date(), ...(options.source ? { source: options.source } : {}) }).where(eq(skills.id, row.id)).returning();
    if (options.draft) await tx.update(skillDrafts).set({ skillId: row.id, baseVersionId: version.id }).where(eq(skillDrafts.id, options.draft.id));
    return { skill: updated, version };
  });
}

export async function createSkillDraft(userId: string, skillId?: string, files?: Record<string, string>, source: Record<string, unknown> = {}) {
  const existing = skillId ? await ownedSkill(userId, skillId) : null;
  if (skillId && !existing) throw new Error("Skill no encontrada");
  const version = existing?.currentVersionId ? await skillVersion(userId, existing.currentVersionId) : null;
  return db.transaction(async (tx) => {
    const [thread] = await tx.insert(threads).values({ userId, title: `Crear skill${existing ? ` · ${existing.name}` : ""}`, origin: "skill_creator", backend: "nas-adk" }).returning();
    const [draft] = await tx.insert(skillDrafts).values({ ownerId: userId, skillId: existing?.id, threadId: thread.id, files: files ?? version?.package.files ?? {}, baseVersionId: version?.id, source: Object.keys(source).length ? source : existing?.source ?? {} }).returning();
    return draft;
  });
}

export async function ownedDraft(userId: string, id: string) {
  const [draft] = await db.select().from(skillDrafts).where(and(eq(skillDrafts.id, id), eq(skillDrafts.ownerId, userId))).limit(1);
  return draft ?? null;
}

export async function draftDetail(userId: string, id: string) {
  const draft = await ownedDraft(userId, id);
  if (!draft) return null;
  const conversation = await db.select().from(messages).where(eq(messages.threadId, draft.threadId)).orderBy(asc(messages.createdAt));
  const tests = await db.select({ test: skillTests, status: runs.status, threadId: runs.threadId, usage: runs.usage, error: runs.error })
    .from(skillTests).leftJoin(runs, eq(runs.id, skillTests.runId)).where(eq(skillTests.draftId, id)).orderBy(desc(skillTests.createdAt)).limit(50);
  const activeRuns = await db.select({ id: runs.id, status: runs.status }).from(runs).where(and(eq(runs.threadId, draft.threadId), inArray(runs.status, ["running", "awaiting_input"])));
  const results = await Promise.all(tests.map(async (item) => {
    const output = item.test.runId ? await db.select({ content: messages.content, tools: messages.tools }).from(messages).where(and(eq(messages.runId, item.test.runId), eq(messages.role, "assistant"))).orderBy(asc(messages.createdAt)) : [];
    const text = output.map((row) => row.content).join("\n");
    return { ...item, test: { id: item.test.id, input: item.test.input, expected: item.test.expected, runId: item.test.runId, createdAt: item.test.createdAt }, output: text, tools: output.flatMap((row) => row.tools ?? []) };
  }));
  const baseVersion = draft.baseVersionId ? await skillVersion(userId, draft.baseVersionId) : null;
  const reports = results.length ? await skillOperation({ op: "evaluate", observations: results.map((item) => ({ output: item.output.slice(0, 120_000), expected: item.test.expected, status: item.status ?? "error" })) }).catch(() => null) : null;
  return { draft, conversation, tests: results.map((item, index) => ({ ...item, report: reports?.reports?.[index] })), activeRuns, baseVersion };
}

export function checkDraftFiles(files: Record<string, string>) {
  if (Object.keys(files).length > 256 || Object.entries(files).some(([path, data]) => path.length > 512 || typeof data !== "string") || Object.values(files).reduce((n, data) => n + Buffer.byteLength(data, "base64"), 0) > 10 * 1024 * 1024) throw new Error("El borrador supera 256 archivos o 10 MB");
}

export async function updateDraftFiles(userId: string, id: string, files: Record<string, string>, revision: number) {
  checkDraftFiles(files);
  const [row] = await db.update(skillDrafts).set({ files, revision: revision + 1, updatedAt: new Date() })
    .where(and(eq(skillDrafts.id, id), eq(skillDrafts.ownerId, userId), eq(skillDrafts.revision, revision))).returning();
  if (!row) throw new Error("El borrador ha cambiado. Recárgalo antes de guardar.");
  return row;
}
