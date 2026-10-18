import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { getProvider } from "@/lib/providers";
import type { HermesRawEvent, HermesTokens, TurnEvent } from "./events";
import { ensureProfile, hermesBin, hermesHome, profileName, workspaceDir } from "./profiles";

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
  await ensureProfile(opts.userId);
  const profile = profileName(opts.userId);
  const provider = opts.provider ? getProvider(opts.provider) : undefined;

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

  const env: NodeJS.ProcessEnv = { ...process.env, HERMES_HOME: hermesHome() };
  if (provider?.envVar && opts.apiKey) env[provider.envVar] = opts.apiKey;
  if (opts.baseUrl) env.OPENAI_BASE_URL = opts.baseUrl;

  const child = spawn(
    /* turbopackIgnore: true */
    hermesBin(),
    args,
    {
      cwd: workspaceDir(opts.userId),
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

  const toolIds = new Map<string, string>();
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
        toolIds.set(raw.name, id);
        opts.onEvent({ kind: "tool-start", id, name: raw.name, input: raw.input });
        break;
      }
      case "tool_result": {
        const id = toolIds.get(raw.name) ?? `t${++toolCounter}`;
        toolIds.delete(raw.name);
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
