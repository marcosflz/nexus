"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { ChatThread } from "./thread";
import { Sidebar } from "./sidebar";
import type {
  PendingAttachment,
  ThreadSummary,
  UiAttachment,
  UiMessage,
  UiSource,
  UiToolCall,
  UiUsage,
} from "./types";

interface ServerMessage {
  id: string;
  role: string;
  content: string;
  sources: UiSource[] | null;
  tools: UiToolCall[] | null;
  attachments: UiAttachment[] | null;
  usage: UiUsage | null;
  createdAt: string;
}

function fromServerMessage(row: ServerMessage): UiMessage {
  return {
    id: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    tools: (row.tools ?? []).map((tool) => ({
      ...tool,
      status: tool.status === "running" ? "complete" : tool.status,
    })),
    sources: row.sources ?? [],
    attachments: row.attachments ?? [],
    usage: row.usage ?? null,
    status: "complete",
    createdAt: row.createdAt,
  };
}

function parseFrame(frame: string): { event: string; data: Record<string, unknown> } | null {
  let event = "message";
  let dataLine = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return null;
  try {
    return { event, data: JSON.parse(dataLine) as Record<string, unknown> };
  } catch {
    return null;
  }
}

export function ChatApp({
  user,
  initialThreads,
}: {
  user: { id: string; email: string };
  initialThreads: ThreadSummary[];
}) {
  const [threads, setThreads] = useState<ThreadSummary[]>(initialThreads);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(
    initialThreads[0]?.id ?? null,
  );
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [focus, setFocus] = useState("web");
  const [mode, setMode] = useState<"search" | "research">("search");
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const abortRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!currentThreadId) {
      setMessages([]);
      return;
    }
    fetch(`/api/threads/${currentThreadId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("no encontrado"))))
      .then((data: { messages: ServerMessage[] }) => {
        if (!cancelled) setMessages(data.messages.map(fromServerMessage));
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentThreadId]);

  const refreshThreads = useCallback(async () => {
    const res = await fetch("/api/threads");
    if (!res.ok) return;
    const data = (await res.json()) as {
      threads: { id: string; title: string; updatedAt: string }[];
    };
    setThreads(data.threads);
  }, []);

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      Array.from(files)
        .slice(0, 5)
        .forEach((file) => form.append("files", file));
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        attachments?: PendingAttachment[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudo procesar el archivo");
      setPendingAttachments((prev) => [...prev, ...(data.attachments ?? [])].slice(0, 5));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "No se pudo subir el archivo");
    } finally {
      setUploading(false);
    }
  }, []);

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const part = message.content[0];
      if (!part || part.type !== "text") return;
      const text = part.text;
      const attachments = pendingAttachments;
      const sentFocus = focus === "web" ? undefined : focus;
      const sentMode = mode === "search" ? undefined : mode;

      setIsRunning(true);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "user",
          content: text,
          tools: [],
          sources: [],
          attachments: attachments.map(({ name, mime, size }) => ({ name, mime, size })),
          status: "complete",
          createdAt: new Date().toISOString(),
        },
      ]);

      const assistantId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          tools: [],
          sources: [],
          attachments: [],
          status: "running",
          createdAt: new Date().toISOString(),
        },
      ]);

      const update = (fn: (m: UiMessage) => UiMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      try {
        let threadId = currentThreadId;
        if (!threadId) {
          const res = await fetch("/api/threads", { method: "POST" });
          if (!res.ok) throw new Error("No se pudo crear el hilo");
          const data = (await res.json()) as { thread: { id: string } };
          threadId = data.thread.id;
          setCurrentThreadId(threadId);
          await refreshThreads();
        }

        const controller = new AbortController();
        abortRef.current = () => controller.abort();

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            text,
            focus: sentFocus,
            mode: sentMode,
            attachments: attachments.length > 0 ? attachments : undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Error del servidor (${res.status})`);
        }

        setPendingAttachments([]);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let boundary = buffer.indexOf("\n\n");
          while (boundary !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseFrame(frame);
            if (parsed) {
              const { event, data } = parsed;
              if (event === "text") {
                update((m) => ({ ...m, content: m.content + String(data.delta ?? "") }));
              } else if (event === "tool") {
                const toolId = String(data.id ?? "");
                const name = String(data.name ?? "tool");
                const phase = String(data.phase ?? "start");
                if (phase === "start") {
                  update((m) => ({
                    ...m,
                    tools: m.tools.some((t) => t.id === toolId)
                      ? m.tools
                      : [...m.tools, { id: toolId, name, input: data.input, status: "running" }],
                  }));
                } else {
                  update((m) => ({
                    ...m,
                    tools: m.tools.map((t) =>
                      t.id === toolId
                        ? {
                            ...t,
                            status: data.isError ? "error" : "complete",
                            durationMs:
                              typeof data.durationMs === "number" ? data.durationMs : undefined,
                          }
                        : t,
                    ),
                  }));
                }
              } else if (event === "sources") {
                update((m) => ({ ...m, sources: (data.sources as UiSource[]) ?? [] }));
              } else if (event === "usage") {
                update((m) => ({ ...m, usage: data as UiUsage }));
              } else if (event === "error") {
                update((m) => ({
                  ...m,
                  status: "error",
                  error: String(data.message ?? "Error desconocido"),
                }));
              } else if (event === "done") {
                update((m) => ({
                  ...m,
                  status: m.status === "error" ? "error" : "complete",
                }));
              }
            }
            boundary = buffer.indexOf("\n\n");
          }
        }

        await refreshThreads();
      } catch (error) {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? "Generación cancelada"
            : error instanceof Error
              ? error.message
              : "Error desconocido";
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, status: "error", error: message } : m)),
        );
      } finally {
        abortRef.current = null;
        setIsRunning(false);
      }
    },
    [currentThreadId, refreshThreads, pendingAttachments, focus, mode],
  );

  const convertMessage = useCallback((message: UiMessage): ThreadMessageLike => {
    const content: Record<string, unknown>[] = [];
    if (message.attachments.length > 0) {
      content.push({
        type: "text",
        text: message.attachments.map((attachment) => `📎 ${attachment.name}`).join("  "),
      });
    }
    for (const tool of message.tools) {
      content.push({
        type: "tool-call",
        toolCallId: tool.id,
        toolName: tool.name,
        args: tool.input ?? {},
        argsText: JSON.stringify(tool.input ?? {}),
        result: tool.status === "complete" ? "" : undefined,
      });
    }
    if (message.content) {
      content.push({ type: "text", text: message.content });
    }
    if (message.error) {
      content.push({ type: "text", text: `\n\n> ⚠️ ${message.error}` });
    }
    for (const source of message.sources) {
      content.push({
        type: "source",
        sourceType: "url",
        id: String(source.id),
        url: source.url,
        title: source.title ?? source.domain,
      });
    }

    return {
      id: message.id,
      role: message.role,
      content: content as unknown as ThreadMessageLike["content"],
      createdAt: new Date(message.createdAt),
      ...(message.role === "assistant"
        ? {
            status:
              message.status === "running"
                ? ({ type: "running" } as const)
                : message.status === "error"
                  ? ({ type: "incomplete", reason: "error" } as const)
                  : ({ type: "complete", reason: "stop" } as const),
          }
        : {}),
    };
  }, []);

  const onCancel = useCallback(async () => {
    abortRef.current?.();
  }, []);

  const runtime = useExternalStoreRuntime<UiMessage>({
    messages,
    convertMessage,
    onNew,
    onCancel,
    isRunning,
  });

  const handleNew = useCallback(() => {
    setCurrentThreadId(null);
    setMessages([]);
    setPendingAttachments([]);
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      await fetch(`/api/threads/${id}`, { method: "DELETE" });
      setThreads((prev) => prev.filter((t) => t.id !== id));
      if (currentThreadId === id) {
        setCurrentThreadId(null);
        setMessages([]);
      }
    },
    [currentThreadId],
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="flex h-screen">
        <Sidebar
          threads={threads}
          currentThreadId={currentThreadId}
          userEmail={user.email}
          onSelect={setCurrentThreadId}
          onNew={handleNew}
          onDelete={handleDelete}
        />
        <main className="min-w-0 flex-1">
          <ChatThread
            focus={focus}
            mode={mode}
            onFocusChange={setFocus}
            onModeChange={setMode}
            attachments={pendingAttachments}
            uploading={uploading}
            uploadError={uploadError}
            onFilesSelected={handleFiles}
            onRemoveAttachment={(index) =>
              setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
            }
          />
        </main>
      </div>
    </AssistantRuntimeProvider>
  );
}
