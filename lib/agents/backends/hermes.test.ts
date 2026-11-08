import { EventType } from "@ag-ui/core";
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { reduceAgUiAll } from "@/lib/agui/reducer";
import type { AgUiEvent } from "@/lib/agui/events";
import type { BackendRunInput } from "../backend";
import { closeText, hermesBackend, newTurnTranslation, turnEventToAgUi } from "./hermes";

describe("turnEventToAgUi", () => {
  it("abre el tramo de texto una vez y lo cierra al llegar una herramienta", () => {
    const ctx = newTurnTranslation("msg");
    const first = turnEventToAgUi({ kind: "text", delta: "Hola " }, ctx);
    const second = turnEventToAgUi({ kind: "text", delta: "mundo" }, ctx);
    const tool = turnEventToAgUi({ kind: "tool-start", id: "t1", name: "web_search", input: { query: "x" } }, ctx);
    const after = turnEventToAgUi({ kind: "text", delta: "Fin" }, ctx);

    expect(first.map((e) => e.type)).toEqual([EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT]);
    expect(second.map((e) => e.type)).toEqual([EventType.TEXT_MESSAGE_CONTENT]);
    expect(tool.map((e) => e.type)).toEqual([
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
    ]);
    // Tras la herramienta, un mensaje de texto nuevo con otro id.
    const firstId = (first[0] as { messageId: string }).messageId;
    const afterId = (after[0] as { messageId: string }).messageId;
    expect(afterId).not.toBe(firstId);
  });

  it("no mete la salida de la herramienta en el evento", () => {
    const ctx = newTurnTranslation("msg");
    const [result] = turnEventToAgUi(
      { kind: "tool-end", id: "t1", name: "web_search", output: "x".repeat(10_000), durationMs: 12, isError: false },
      ctx,
    );
    expect(result).toMatchObject({
      type: EventType.TOOL_CALL_RESULT,
      toolCallId: "t1",
      content: "",
      metadata: { isError: false, durationMs: 12 },
    });
  });

  it("el ciclo de vida lo pone el ejecutor, no la traducción", () => {
    const ctx = newTurnTranslation("msg");
    expect(turnEventToAgUi({ kind: "done", text: "x" }, ctx)).toEqual([]);
    expect(turnEventToAgUi({ kind: "error", message: "x" }, ctx)).toEqual([]);
    expect(closeText(ctx)).toEqual([]);
  });
});

const FAKE = `#!/usr/bin/env bash
if [ "$1" = "profile" ]; then exit 0; fi
cat > /dev/null
cat <<'EOF'
{"type":"system","session_id":"sess-1"}
{"type":"tool_use","name":"web_search","input":{"query":"uno"}}
{"type":"tool_use","name":"web_search","input":{"query":"dos"}}
{"type":"tool_result","name":"web_search","output":"{\\"results\\":[{\\"url\\":\\"https://example.com/a\\",\\"title\\":\\"A\\"}]}","duration_ms":5}
{"type":"tool_result","name":"web_search","output":"{}","duration_ms":9,"is_error":true}
{"type":"text","text":"Hola "}
{"type":"text","text":"mundo [1]"}
{"type":"result","session_id":"sess-1","exit_code":0,"text":"Hola mundo [1]","tokens":{"total":42}}
EOF
exit 0
`;

describe("hermesBackend.run", () => {
  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "nexus-hermes-backend-"));
    const bin = path.join(dir, "fake-hermes");
    await writeFile(bin, FAKE, { mode: 0o755 });
    await chmod(bin, 0o755);
    process.env.HERMES_BIN = bin;
    process.env.HERMES_HOME = path.join(dir, "home");
  });

  const input: BackendRunInput = {
    runId: "run-abc",
    threadId: "thread-1",
    userId: "00000000-0000-0000-0000-0000000000bb",
    initiator: "user",
    credential: { provider: "openrouter", model: "fake/model", apiKey: "k", baseUrl: null },
    userText: "pregunta",
  };

  it("emite eventos que el reducer convierte en el mensaje correcto", async () => {
    const events: AgUiEvent[] = [];
    const result = await hermesBackend.run(input, (event) => events.push(event), new AbortController().signal);

    expect(result.outcome).toBe("success");
    expect(result.backendSessionId).toBe("sess-1");
    expect(result.finalText).toBe("Hola mundo [1]");
    expect(result.sources.map((source) => source.url)).toContain("https://example.com/a");

    const { message } = reduceAgUiAll(events, "m");
    expect(message.content).toBe("Hola mundo [1]");
    // Dos web_search en paralelo: cada resultado cae en su herramienta.
    const tools = message.tools.filter((tool) => tool.name === "web_search");
    expect(tools.map((tool) => [tool.id, tool.status, tool.durationMs])).toEqual([
      ["t1", "complete", 5],
      ["t2", "error", 9],
    ]);
    expect(message.sources).toHaveLength(1);
    // Orden real: herramientas primero (el texto llegó después de ellas).
    expect(message.parts?.map((part) => part.type)).toEqual(["tool", "tool", "text"]);
  });

  it("anuncia la sesión de Hermes como evento CUSTOM", async () => {
    const events: AgUiEvent[] = [];
    await hermesBackend.run(input, (event) => events.push(event), new AbortController().signal);
    const session = events.find((event) => (event as { name?: string }).name === "nexus.session");
    expect(session).toMatchObject({ value: { sessionId: "sess-1" } });
  });
});
