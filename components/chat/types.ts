export interface ThreadSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface UiToolCall {
  id: string;
  name: string;
  input?: unknown;
  status: "running" | "complete" | "error";
  durationMs?: number;
}

export interface UiSource {
  id: number;
  url: string;
  title?: string;
  domain: string;
}

export interface UiAttachment {
  name: string;
  mime?: string;
  size?: number;
}

export interface PendingAttachment extends UiAttachment {
  text: string;
  truncated: boolean;
}

export interface UiUsage {
  input?: number;
  output?: number;
  total?: number;
  cache_read?: number;
  cache_write?: number;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: UiToolCall[];
  sources: UiSource[];
  attachments: UiAttachment[];
  usage?: UiUsage | null;
  status: "running" | "complete" | "error";
  error?: string;
  createdAt: string;
}
