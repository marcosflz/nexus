export interface HermesTokens {
  input?: number;
  output?: number;
  total?: number;
  cache_read?: number;
  cache_write?: number;
}

export type HermesRawEvent =
  | { type: "system"; subtype?: string; model?: string; session_id?: string; timestamp?: number }
  | { type: "text"; text?: string; timestamp?: number }
  | {
      type: "tool_use";
      name: string;
      input?: unknown;
      /** Hermes hoy no emite id; si lo hiciera, tiene prioridad sobre la cola FIFO. */
      tool_use_id?: string;
      call_id?: string;
      timestamp?: number;
    }
  | {
      type: "tool_result";
      name: string;
      tool_use_id?: string;
      call_id?: string;
      output?: string;
      duration_ms?: number;
      is_error?: boolean;
      timestamp?: number;
    }
  | {
      type: "result";
      session_id?: string;
      exit_code?: number;
      text?: string;
      tokens?: HermesTokens;
      duration_ms?: number;
      error?: string;
      timestamp?: number;
    };

export type TurnEvent =
  | { kind: "session"; sessionId: string }
  | { kind: "text"; delta: string }
  | { kind: "tool-start"; id: string; name: string; input?: unknown }
  | {
      kind: "tool-end";
      id: string;
      name: string;
      output?: string;
      isError?: boolean;
      durationMs?: number;
    }
  | { kind: "done"; text: string; usage?: HermesTokens }
  | { kind: "error"; message: string };
