import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { HermesRawEvent, HermesTokens, TurnEvent } from "./events";
import { ensureProfile, hermesBin, hermesHome, workspaceDirFor } from "./profiles";

export interface RunTurnOptions {
  userId: string;
  provider?: string;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  prompt: string;
  sessionId?: string | null;
  maxTurns?: number;
  signal?: AbortSignal;
  onEvent: (event: TurnEvent) => void;
}

export interface RunTurnResult {
  text: string;
  sessionId: string | null;
  usage?: HermesTokens;
}

export async function runHermesTurn(opts: RunTurnOptions): Promise<RunTurnResult> {
  const profile = await ensureProfile(opts.userId);

  const args = [
    "-p",
    profile,
    "chat",
    "--oneshot",
    "--query-file",
    "-",
    "--format",
    "stream-json",
    "--toolsets",
    "web,skills",
    "--source",
    "tool",
    "--model",
    opts.model,
    "--yolo",
  ];
  if (opts.provider) args.push("--provider", opts.provider);
  if (opts.sessionId) args.push("--resume", opts.sessionId);
  if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));
  // El gateway de Hermes ignora las claves del entorno del CLI y solo respeta
  // --api-key/--base-url (valen para esta ejecución y no se guardan en el perfil).
  if (opts.apiKey) args.push("--api-key", opts.apiKey);
  if (opts.baseUrl) args.push("--base-url", opts.baseUrl);

  const env: NodeJS.ProcessEnv = { ...process.env, HERMES_HOME: hermesHome() };

  const child = spawn(
    /* turbopackIgnore: true */
    hermesBin(),
    args,
    {
      cwd: workspaceDirFor(profile),
      env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
    if (stderr.length > 8000) stderr = stderr.slice(-8000);
  });

  const onAbort = () => {
    child.kill("SIGTERM");
  };
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  // Hermes no emite id en tool_use/tool_result, así que se emparejan por nombre
  // con una cola FIFO: dos `web_search` en paralelo ya no se pisan. Si Hermes
  // empieza a enviar `tool_use_id`/`call_id`, ese id manda sobre la cola.
  const pendingByName = new Map<string, string[]>();
  const idsByExternal = new Map<string, string>();
  let toolCounter = 0;
  let sessionId: string | null = opts.sessionId ?? null;
  let accumulated = "";
  let finalText = "";
  let usage: HermesTokens | undefined;
  let sawResult = false;
  let turnError: string | null = null;

  const reader = createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return;
    let raw: HermesRawEvent;
    try {
      raw = JSON.parse(trimmed) as HermesRawEvent;
    } catch {
      return;
    }

    switch (raw.type) {
      case "system":
        if (raw.session_id) {
          sessionId = raw.session_id;
          opts.onEvent({ kind: "session", sessionId: raw.session_id });
        }
        break;
      case "text":
        if (raw.text) {
          accumulated += raw.text;
          opts.onEvent({ kind: "text", delta: raw.text });
        }
        break;
      case "tool_use": {
        const id = `t${++toolCounter}`;
        const external = raw.tool_use_id ?? raw.call_id;
        if (external) {
          idsByExternal.set(external, id);
        } else {
          const queue = pendingByName.get(raw.name) ?? [];
          queue.push(id);
          pendingByName.set(raw.name, queue);
        }
        opts.onEvent({ kind: "tool-start", id, name: raw.name, input: raw.input });
        break;
      }
      case "tool_result": {
        const external = raw.tool_use_id ?? raw.call_id;
        let id: string | undefined;
        if (external) {
          id = idsByExternal.get(external);
          idsByExternal.delete(external);
        } else {
          id = pendingByName.get(raw.name)?.shift();
        }
        id ??= `t${++toolCounter}`;
        opts.onEvent({
          kind: "tool-end",
          id,
          name: raw.name,
          output: raw.output,
          isError: raw.is_error,
          durationMs: raw.duration_ms,
        });
        break;
      }
      case "result":
        sawResult = true;
        if (raw.session_id) sessionId = raw.session_id;
        finalText = raw.text ?? "";
        usage = raw.tokens;
        if (raw.error) turnError = raw.error;
        break;
    }
  });

  child.stdin.write(opts.prompt);
  child.stdin.end();

  const exitCode: number = await new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? -1));
  });
  reader.close();
  opts.signal?.removeEventListener("abort", onAbort);

  if (opts.signal?.aborted) {
    throw new Error("turno cancelado");
  }
  if (!sawResult) {
    throw new Error(
      `Hermes terminó sin resultado (exit ${exitCode}): ${stderr.slice(-500) || "sin stderr"}`,
    );
  }
  if (turnError) {
    throw new Error(turnError);
  }

  const text = finalText || accumulated;
  opts.onEvent({ kind: "done", text, usage });
  return { text, sessionId, usage };
}
