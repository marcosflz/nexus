import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { TurnEvent } from "./events";
import { runHermesTurn } from "./runner";

const FAKE = `#!/usr/bin/env bash
if [ "$1" = "profile" ]; then exit 0; fi
echo "$@" >> "$FAKE_ARGS_FILE"
echo "ENV:$OPENROUTER_API_KEY" >> "$FAKE_ARGS_FILE"
cat > /dev/null
cat <<'EOF'
{"type":"system","subtype":"init","model":"fake","session_id":"sess-1"}
{"type":"tool_use","name":"web_search","input":{"query":"bun"}}
{"type":"tool_result","name":"web_search","output":"{\\"results\\":[{\\"url\\":\\"https://example.com/a\\",\\"title\\":\\"A\\"}]}","duration_ms":12}
{"type":"text","text":"Hola "}
{"type":"text","text":"mundo [1]"}
{"type":"result","session_id":"sess-1","exit_code":0,"text":"Hola mundo [1]","tokens":{"total":42}}
EOF
exit 0
`;

const USER_ID = "00000000-0000-0000-0000-000000000001";

describe("runHermesTurn", () => {
  let argsFile = "";

  beforeAll(async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "plexo-hermes-"));
    argsFile = path.join(dir, "args.txt");
    const bin = path.join(dir, "fake-hermes");
    await writeFile(bin, FAKE, { mode: 0o755 });
    await chmod(bin, 0o755);
    process.env.HERMES_BIN = bin;
    process.env.HERMES_HOME = path.join(dir, "home");
    process.env.FAKE_ARGS_FILE = argsFile;
  });

  it("normaliza el JSONL de Hermes en TurnEvents", async () => {
    const events: TurnEvent[] = [];
    const result = await runHermesTurn({
      userId: USER_ID,
      provider: "openrouter",
      model: "fake/model",
      apiKey: "test-key",
      prompt: "¿qué es bun?",
      onEvent: (event) => events.push(event),
    });

    expect(result.sessionId).toBe("sess-1");
    expect(result.text).toBe("Hola mundo [1]");
    expect(result.usage?.total).toBe(42);

    expect(events.map((event) => event.kind)).toEqual([
      "session",
      "tool-start",
      "tool-end",
      "text",
      "text",
      "done",
    ]);
    expect(events.at(-1)).toMatchObject({ kind: "done", text: "Hola mundo [1]" });

    const args = await readFile(argsFile, "utf8");
    expect(args).toContain("ENV:test-key");
  });

  it("pasa flags del runner, resume y max-turns", async () => {
    await runHermesTurn({
      userId: USER_ID,
      model: "fake/model",
      prompt: "investiga",
      sessionId: "sess-0",
      maxTurns: 40,
      onEvent: () => {},
    });

    const lines = (await readFile(argsFile, "utf8")).trim().split("\n");
    const chat = lines.filter((line) => line.includes(" chat ")).at(-1) ?? "";
    expect(chat).toContain("--format stream-json");
    expect(chat).toContain("--toolsets web,skills");
    expect(chat).toContain("--source tool");
    expect(chat).toContain("--resume sess-0");
    expect(chat).toContain("--max-turns 40");
  });
});
