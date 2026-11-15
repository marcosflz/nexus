import { and, eq } from "drizzle-orm";
import { hasPermission } from "@/lib/access";
import { defaultAgentSpec } from "@/lib/agents/spec";
import type { BackendRunInput } from "@/lib/agents/backend";
import { db } from "@/lib/db";
import { bots, botVersions, runs, skillTests, type RuntimeSnapshot } from "@/lib/db/schema";
import { catalogFor, ownedDraft, packageRef } from "@/lib/skills/store";
import { getUserAccess } from "@/lib/users";

/** Pin once, before execution. Resumes reuse this snapshot. No secrets are stored. */
export async function prepareRuntime(input: BackendRunInput): Promise<BackendRunInput> {
  const [run] = await db.select().from(runs).where(and(eq(runs.id, input.runId), eq(runs.userId, input.userId))).limit(1);
  if (!run) throw new Error("Run no encontrado");
  const account = await getUserAccess(input.userId);
  if (!account || account.disabled) throw new Error("Esta cuenta está desactivada");
  let snapshot = run.runtimeSnapshot;
  if (run.botId && !hasPermission(account, "bots")) throw new Error("Nexbots no permitidos");
  if (snapshot?.skills.length && !hasPermission(account, "skills")) throw new Error("Skills no permitidas");
  const [bot] = run.botId ? await db.select().from(bots).where(and(eq(bots.id, run.botId), eq(bots.ownerId, input.userId))).limit(1) : [];
  if (run.botId && !bot) throw new Error("Nexbot no encontrado");
  if (!snapshot) {
    if (run.botId && (!bot || !hasPermission(account, "bots"))) throw new Error("Nexbot no disponible");
    if (input.creatorDraftId && !(await ownedDraft(input.userId, input.creatorDraftId))) throw new Error("Borrador no encontrado");
    const versionId = input.botVersionId ?? bot?.currentVersionId;
    const [version] = versionId && bot ? await db.select().from(botVersions).where(and(eq(botVersions.id, versionId), eq(botVersions.botId, bot.id))) : [];
    if (versionId && !version) throw new Error("La versión del Nexbot ya no está disponible");
    const refs = hasPermission(account, "skills") && !input.creatorDraftId && !input.checkpoint ? await catalogFor(input.userId, version?.skillIds ?? bot?.skillIds) : [];
    if (input.testId) {
      if (!hasPermission(account, "skills")) throw new Error("No tienes permiso para probar skills");
      const [test] = await db.select().from(skillTests).where(and(eq(skillTests.id, input.testId), eq(skillTests.ownerId, input.userId)));
      if (!test) throw new Error("Prueba no encontrada");
      refs.splice(0, refs.length, packageRef(test.id, test.package));
    }
    const explicit = [...(input.explicitSkills ?? [])];
    const slash = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\s|$)/.exec(input.userText);
    if (slash) explicit.push(slash[1]);
    if (input.testId) explicit.push(input.testId);
    const resolved = [...new Set(explicit)].map((id) => {
      const ref = refs.find((item) => item.id === id || item.name === id);
      if (!ref) throw new Error(`La skill «${id}» no está disponible en este chat o Nexbot`);
      return ref.id;
    });
    snapshot = {
      spec: { ...(input.agent?.spec ?? defaultAgentSpec()), model: { provider: input.credential.provider, model: input.credential.model } }, skills: refs, explicitSkills: resolved,
      turn: { focus: input.focus, mode: input.mode, openui: input.openui, openuiProfile: input.openuiProfile, openuiRequested: input.openuiRequested, limits: input.limits },
      scripts: Boolean(bot?.environmentEnabled && bot.status === "running" && hasPermission(account, "computer") && !input.computer && input.initiator !== "room"),
      botVersionId: versionId,
      ...(input.creatorDraftId ? { creatorDraftId: input.creatorDraftId } : {}),
      ...(input.testId ? { testId: input.testId } : {}),
      ...(input.room ? { room: input.room } : {}),
    } satisfies RuntimeSnapshot;
    await db.update(runs).set({ runtimeSnapshot: snapshot }).where(eq(runs.id, run.id));
  }
  return { ...input, ...snapshot.turn, room: snapshot.room ?? input.room, botId: run.botId, agent: { id: null, versionId: null, spec: snapshot.spec },
    skillRefs: snapshot.skills, explicitSkills: snapshot.explicitSkills, skillScripts: snapshot.scripts,
    creatorDraftId: snapshot.creatorDraftId, testId: snapshot.testId };
}
