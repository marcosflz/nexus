import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { bots, botVersions } from "@/lib/db/schema";
import { resolveRuntime, runtimeSpecSchema } from "@/lib/runtime/spec";

export function runtimeOfBot(bot: typeof bots.$inferSelect) {
  return resolveRuntime({ name: bot.name, role: bot.role, instructions: bot.instructions, avatar: bot.avatar }, bot.execution);
}

export async function botProfile(botId: string) {
  const [bot] = await db.select().from(bots).where(eq(bots.id, botId)).limit(1);
  if (!bot) return { ok: false as const, error: "Nexbot no encontrado", paused: false };
  const [version] = bot.currentVersionId ? await db.select().from(botVersions).where(eq(botVersions.id, bot.currentVersionId)) : [];
  return { ok: true as const, botVersionId: bot.currentVersionId, agent: { id: null, versionId: null }, spec: version ? runtimeSpecSchema.parse(version.spec) : runtimeOfBot(bot) };
}
