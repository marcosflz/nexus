import { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  credentials,
  messages,
  threads,
  type MessageAttachmentMeta,
  type PersistedTool,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { decryptSecret } from "@/lib/crypto";
import { runHermesTurn } from "@/lib/hermes/runner";
import { buildPrompt } from "@/lib/hermes/prompts";
import { buildSources, type SourceItem } from "@/lib/sources";
import { OPENUI_TOOL_NAME, splitOpenUiBlocks } from "@/lib/openui/blocks";
import { openuiToolsEnabled } from "@/lib/openui/prompt";
import { validateOpenUiProgram } from "@/lib/openui/validate";

export const runtime = "nodejs";
export const maxDuration = 900;

const attachmentSchema = z.object({
  name: z.string().min(1).max(200),
  mime: z.string().max(120).optional(),
  size: z.number().int().nonnegative().optional(),
  text: z.string().max(120_000),
});

const bodySchema = z.object({
  threadId: z.string().uuid(),
  text: z.string().min(1).max(8000),
  focus: z.enum(["web", "academic", "reddit", "finance", "news"]).optional(),
  mode: z.enum(["search", "research"]).optional(),
  attachments: z.array(attachmentSchema).max(5).optional(),
  /** El usuario ha pedido expresamente una respuesta con interfaz. */
  ui: z.boolean().optional(),
});

const MAX_TOOL_OUTPUT = 200_000;
const RESEARCH_MAX_TURNS = 40;

/**
 * Convierte el texto final del asistente en prosa + entradas de tool.
 *
 * Los bloques OpenUI cerrados y válidos se guardan como tool parts para que el
 * renderer los pinte sin re-parsear nada al recargar. Un bloque inválido no se
 * descarta: se devuelve a la prosa como código, que es mejor que un hueco.
 */
function splitOpenUiResult(text: string): { content: string; tools: PersistedTool[] } {
  const prose: string[] = [];
  const tools: PersistedTool[] = [];

  for (const segment of splitOpenUiBlocks(text)) {
    if (segment.type === "text") {
      prose.push(segment.text);
      continue;
    }
    if (!segment.closed) {
      prose.push(`\`\`\`openui\n${segment.program}\n\`\`\`\n`);
      continue;
    }
    const validation = validateOpenUiProgram(segment.program);
    if (validation.ok) {
      tools.push({
        id: `openui-${segment.index}`,
        name: OPENUI_TOOL_NAME,
        kind: "openui",
        input: { ui: segment.program },
        argsText: JSON.stringify({ ui: segment.program }),
        status: "complete",
      });
    } else {
      console.warn("[plexo] bloque OpenUI descartado:", validation.error);
      prose.push(`\`\`\`openui\n${segment.program}\n\`\`\`\n`);
    }
  }

  return { content: prose.join("").replace(/\n{3,}/g, "\n\n"), tools };
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "No autenticado" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Petición no válida" }, { status: 400 });
  }
  const { threadId, text, focus, mode, attachments = [], ui } = parsed.data;

  const [thread] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, threadId), eq(threads.userId, user.id)))
    .limit(1);
  if (!thread) {
    return Response.json({ error: "Hilo no encontrado" }, { status: 404 });
  }

  const [credential] = await db
    .select()
    .from(credentials)
    .where(eq(credentials.userId, user.id))
    .limit(1);
  if (!credential) {
    return Response.json(
      { error: "Configura tu proveedor y API key en Ajustes", code: "no_credential" },
      { status: 400 },
    );
  }

  let apiKey: string | null = null;
  if (credential.apiKeyEnc) {
    try {
      apiKey = decryptSecret(credential.apiKeyEnc);
    } catch {
      return Response.json(
        { error: "No se pudo descifrar la API key (¿cambió APP_ENCRYPTION_KEY?)" },
        { status: 500 },
      );
    }
  }

  const attachmentMeta: MessageAttachmentMeta[] = attachments.map(
    ({ name, mime, size }) => ({ name, mime, size }),
  );
  await db.insert(messages).values({
    threadId,
    role: "user",
    content: text,
    attachments: attachmentMeta.length > 0 ? attachmentMeta : null,
  });
  await db
    .update(threads)
    .set({
      ...(thread.title === "Nuevo chat" ? { title: text.slice(0, 60) } : {}),
      updatedAt: new Date(),
    })
    .where(eq(threads.id, threadId));

  const openui = openuiToolsEnabled({ focus, mode, userToggle: ui === true });
  const prompt = buildPrompt({ text, focus, mode, attachments, openui });
  const encoder = new TextEncoder();
  const toolOutputs: string[] = [];
  const toolStates: PersistedTool[] = [];
  let usage: Awaited<ReturnType<typeof runHermesTurn>>["usage"];

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      const abort = new AbortController();
      const onRequestAbort = () => abort.abort();
      req.signal.addEventListener("abort", onRequestAbort, { once: true });

      try {
        const result = await runHermesTurn({
          userId: user.id,
          provider: credential.provider,
          model: credential.model,
          apiKey,
          baseUrl: credential.baseUrl,
          prompt,
          sessionId: thread.hermesSessionId,
          ...(mode === "research" ? { maxTurns: RESEARCH_MAX_TURNS } : {}),
          signal: abort.signal,
          onEvent: (event) => {
            switch (event.kind) {
              case "session":
                send("session", { sessionId: event.sessionId });
                break;
              case "text":
                send("text", { delta: event.delta });
                break;
              case "tool-start":
                toolStates.push({
                  id: event.id,
                  name: event.name,
                  input: event.input,
                  status: "running",
                });
                send("tool", {
                  id: event.id,
                  name: event.name,
                  phase: "start",
                  input: event.input,
                });
                break;
              case "tool-end": {
                if (event.output && event.output.length <= MAX_TOOL_OUTPUT) {
                  toolOutputs.push(event.output);
                }
                const state = toolStates.find((tool) => tool.id === event.id);
                if (state) {
                  state.status = event.isError ? "error" : "complete";
                  state.durationMs = event.durationMs;
                }
                send("tool", {
                  id: event.id,
                  name: event.name,
                  phase: "end",
                  isError: event.isError ?? false,
                  durationMs: event.durationMs,
                });
                break;
              }
              case "done":
                usage = event.usage;
                if (event.usage) send("usage", event.usage);
                break;
              case "error":
                send("error", { message: event.message });
                break;
            }
          },
        });

        if (result.sessionId && result.sessionId !== thread.hermesSessionId) {
          await db
            .update(threads)
            .set({ hermesSessionId: result.sessionId })
            .where(eq(threads.id, threadId));
        }

        const sources: SourceItem[] = buildSources(result.text, toolOutputs);
        const { content, tools: openuiTools } = splitOpenUiResult(result.text);
        const [assistantMessage] = await db
          .insert(messages)
          .values({
            threadId,
            role: "assistant",
            content,
            sources,
            tools: [...toolStates, ...openuiTools],
            usage: result.usage ?? usage ?? null,
          })
          .returning({ id: messages.id });
        await db.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));

        send("sources", { sources });
        send("done", { messageId: assistantMessage.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Error desconocido";
        send("error", { message });
      } finally {
        req.signal.removeEventListener("abort", onRequestAbort);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
