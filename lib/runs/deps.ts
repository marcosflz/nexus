import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { messages, threads } from "@/lib/db/schema";
import { runBus } from "./bus";
import { makeOnFinished } from "./finish-hooks";
import type { ExecutorDeps } from "./executor";
import { appendEvents, finishRun, heartbeat } from "./store";

/** Dependencias reales del ejecutor: Postgres + el bus del proceso. */
export function defaultExecutorDeps(): ExecutorDeps {
  return {
    appendEvents,
    heartbeat,
    finishRun,
    bus: runBus,
    // Los runs de usuario también encadenan a los agentes suscritos a su fin.
    onFinished: makeOnFinished(),

    async saveAssistantMessage({ threadId, runId, content, sources, tools, parts, followups, usage, reasoning }) {
      const [row] = await db
        .insert(messages)
        .values({
          threadId,
          runId,
          role: "assistant",
          content,
          sources,
          tools,
          parts,
          followups,
          usage,
          reasoning: reasoning ?? null,
        })
        .returning({ id: messages.id });
      await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
      return row.id;
    },
  };
}
