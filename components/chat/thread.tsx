"use client";

import {
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { FOCUS_OPTIONS } from "@/lib/focus";
import { ToolCard, WebExtractTool, WebSearchTool } from "./tools";
import type { PendingAttachment } from "./types";

const MarkdownText = () => (
  <MarkdownTextPrimitive remarkPlugins={[remarkGfm]} className="aui-md" />
);

const ReasoningBlock = () => {
  const text = useAuiState((state) =>
    state.part.type === "reasoning" ? state.part.text : "",
  );
  if (!text) return null;
  return (
    <details className="my-2 rounded-lg border border-neutral-800 bg-neutral-950/60 px-3 py-2 text-sm text-neutral-400">
      <summary className="cursor-pointer select-none text-xs uppercase tracking-wide text-neutral-500">
        Razonamiento
      </summary>
      <div className="mt-2 whitespace-pre-wrap">{text}</div>
    </details>
  );
};

const SourceChip = () => {
  const source = useAuiState((state) =>
    state.part.type === "source" ? state.part : null,
  );
  if (!source || source.sourceType !== "url") return null;
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer noopener"
      title={source.url}
      className="mr-1.5 mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-xs text-neutral-300 hover:border-neutral-600"
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-neutral-400">
        {source.id}
      </span>
      <span className="truncate">{source.title ?? source.url}</span>
    </a>
  );
};

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-neutral-800 px-4 py-2.5">
        <MessagePrimitive.Parts components={{ Text: MarkdownText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex flex-col">
      <div className="max-w-full">
        <MessagePrimitive.Parts
          components={{
            Text: MarkdownText,
            Reasoning: ReasoningBlock,
            Source: SourceChip,
            tools: {
              Fallback: ToolCard,
              by_name: {
                web_search: WebSearchTool,
                web_extract: WebExtractTool,
              },
            },
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Plexo</h1>
      <p className="max-w-md text-sm text-neutral-400">
        Pregunta lo que quieras: Plexo busca en la web, lee las fuentes y responde
        con citas verificables.
      </p>
    </div>
  );
}

export interface ChatThreadProps {
  focus: string;
  mode: "search" | "research";
  onFocusChange: (focus: string) => void;
  onModeChange: (mode: "search" | "research") => void;
  attachments: PendingAttachment[];
  uploading: boolean;
  uploadError: string | null;
  onFilesSelected: (files: FileList | null) => void;
  onRemoveAttachment: (index: number) => void;
}

export function ChatThread({
  focus,
  mode,
  onFocusChange,
  onModeChange,
  attachments,
  uploading,
  uploadError,
  onFilesSelected,
  onRemoveAttachment,
}: ChatThreadProps) {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6">
          <ThreadPrimitive.Empty>
            <div className="py-24">
              <EmptyState />
            </div>
          </ThreadPrimitive.Empty>
          <div className="space-y-6">
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
          </div>
        </div>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-neutral-800 bg-neutral-950/80 px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">
          {attachments.length > 0 || uploadError ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              {attachments.map((attachment, index) => (
                <span
                  key={`${attachment.name}-${index}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-800 bg-neutral-900 px-2.5 py-1 text-neutral-300"
                >
                  <span className="truncate" title={attachment.name}>
                    📎 {attachment.name}
                    {attachment.truncated ? " (recortado)" : ""}
                  </span>
                  <button
                    onClick={() => onRemoveAttachment(index)}
                    className="text-neutral-500 hover:text-red-400"
                    aria-label={`Quitar ${attachment.name}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              {uploadError ? <span className="text-red-400">{uploadError}</span> : null}
            </div>
          ) : null}

          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {FOCUS_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => onFocusChange(option.id)}
                className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                  focus === option.id
                    ? "border-neutral-500 bg-neutral-800 text-neutral-100"
                    : "border-neutral-800 text-neutral-400 hover:border-neutral-600"
                }`}
              >
                {option.label}
              </button>
            ))}
            <div className="ml-auto flex overflow-hidden rounded-full border border-neutral-800">
              <button
                onClick={() => onModeChange("search")}
                className={`px-2.5 py-1 text-xs ${
                  mode === "search"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Búsqueda
              </button>
              <button
                onClick={() => onModeChange("research")}
                className={`px-2.5 py-1 text-xs ${
                  mode === "research"
                    ? "bg-neutral-800 text-neutral-100"
                    : "text-neutral-400 hover:text-neutral-200"
                }`}
              >
                Research
              </button>
            </div>
          </div>

          <ComposerPrimitive.Root className="flex w-full items-end gap-2">
            <label
              className={`cursor-pointer rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-400 hover:border-neutral-600 ${
                uploading ? "opacity-50" : ""
              }`}
              title="Adjuntar PDF, DOCX, TXT, MD, CSV o JSON (máx. 10 MB)"
            >
              <input
                type="file"
                multiple
                hidden
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log"
                disabled={uploading}
                onChange={(event) => {
                  onFilesSelected(event.target.files);
                  event.target.value = "";
                }}
              />
              {uploading ? "…" : "📎"}
            </label>
            <ComposerPrimitive.Input
              rows={2}
              placeholder={
                mode === "research"
                  ? "Describe la investigación que quieres..."
                  : "Pregunta lo que quieras..."
              }
              className="max-h-40 min-h-10 w-full resize-none rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
            <ComposerPrimitive.Send className="rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-40">
              Enviar
            </ComposerPrimitive.Send>
          </ComposerPrimitive.Root>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
}
