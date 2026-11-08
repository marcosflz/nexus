"use client";

import { useState } from "react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import {
  Copy,
  FileText,
  Folder,
  ListTree,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { NexusLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useChatActions, type MessageCustom } from "./chat-context";
import { Composer } from "./composer";
import {
  ApprovalCards,
  AssistantText,
  HiddenTool,
  ReasoningPart,
  RunSteps,
  SourcesList,
  SourcesProvider,
  UserText,
  useMessageSources,
} from "./message-parts";
import { OPENUI_PROMPT_TOOL_NAME, OPENUI_TOOL_NAME, OpenUIPresentTool, OpenUIPromptTool } from "./openui";
import type { PendingAttachment } from "./types";

function UserAttachments() {
  const custom = useAuiState((state) => state.message.metadata?.custom) as MessageCustom | undefined;
  const files = custom?.attachments ?? [];
  if (files.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      {files.map((file, index) => (
        <span
          key={`${file.name}-${index}`}
          className="border-border bg-surface-2 inline-flex max-w-60 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
        >
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate">{file.name}</span>
        </span>
      ))}
    </div>
  );
}

const TIME_FORMAT = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });

function MessageTime() {
  const createdAt = useAuiState((state) => state.message.createdAt);
  if (!createdAt) return null;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time dateTime={date.toISOString()} className="text-muted-fg mr-1 text-[12px] tabular-nums">
      {TIME_FORMAT.format(date)}
    </time>
  );
}

/** Mensaje del usuario: burbuja a la derecha; hora, editar y copiar al pasar el ratón. */
function UserMessage() {
  return (
    <MessagePrimitive.Root className="group animate-in fade-in-0 slide-in-from-bottom-1 flex flex-col items-end pt-10 duration-300 first:pt-2">
      <div className="flex w-full items-start justify-end gap-2">
        <ActionBarPrimitive.Root
          hideWhenRunning
          className="mt-2 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
        >
          <MessageTime />
          <ActionBarPrimitive.Edit asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-fg rounded-full" aria-label="Editar pregunta">
              <Pencil className="size-3.5" />
            </Button>
          </ActionBarPrimitive.Edit>
          <ActionBarPrimitive.Copy asChild>
            <Button variant="ghost" size="icon-sm" className="text-muted-fg rounded-full" aria-label="Copiar pregunta">
              <Copy className="size-3.5" />
            </Button>
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>
        <div className="bg-surface-2 text-fg max-w-[85%] rounded-2xl px-4 py-3 text-[15px] leading-relaxed break-words sm:max-w-[75%]">
          <MessagePrimitive.Parts components={{ Text: UserText }} />
        </div>
      </div>
      <UserAttachments />
    </MessagePrimitive.Root>
  );
}

function EditComposer() {
  return (
    <MessagePrimitive.Root className="pt-10 first:pt-2">
      <ComposerPrimitive.Root className="border-border-strong bg-surface flex w-full flex-col gap-2 rounded-2xl border p-3">
        <ComposerPrimitive.Input
          autoFocus
          className="max-h-60 min-h-12 w-full resize-none bg-transparent px-1 py-1 text-[15px] outline-none"
        />
        <div className="flex justify-end gap-2">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="rounded-full">
              Cancelar
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="rounded-full">
              Enviar
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function Related() {
  const custom = useAuiState((state) => state.message.metadata?.custom) as MessageCustom | undefined;
  const running = useAuiState((state) => state.message.status?.type === "running");
  const isLast = useAuiState((state) => state.message.isLast);
  const actions = useChatActions();
  const questions = custom?.followups ?? [];
  if (running || !isLast || questions.length === 0) return null;

  return (
    <section className="mt-8">
      <h3 className="mb-1 flex items-center gap-2 text-[18px] font-medium">
        <ListTree className="size-5" /> Relacionado
      </h3>
      <ul className="divide-border border-border divide-y border-t">
        {questions.map((question) => (
          <li key={question}>
            <button
              type="button"
              disabled={actions.isRunning}
              onClick={() => actions.send(question)}
              className="text-fg hover:text-brand flex w-full items-center justify-between gap-4 py-3 text-left text-[15px] transition-colors disabled:opacity-50"
            >
              <span>{question}</span>
              <Plus className="text-brand size-4 shrink-0" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MessageActions() {
  const custom = useAuiState((state) => state.message.metadata?.custom) as MessageCustom | undefined;
  const actions = useChatActions();
  const serverId = custom?.serverId;
  const rating = custom?.rating ?? null;

  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="text-muted-fg mt-5 flex items-center justify-between"
    >
      <div className="flex items-center gap-1">
        <ActionBarPrimitive.Reload asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Reescribir respuesta">
            <RefreshCw className="size-4" />
          </Button>
        </ActionBarPrimitive.Reload>
        <ActionBarPrimitive.Copy asChild>
          <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Copiar respuesta">
            <Copy className="size-4" />
          </Button>
        </ActionBarPrimitive.Copy>
      </div>
      {serverId ? (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("rounded-full", rating === 1 && "text-brand")}
            aria-label="Respuesta útil"
            aria-pressed={rating === 1}
            onClick={() => actions.rate(serverId, rating === 1 ? null : 1)}
          >
            <ThumbsUp className={cn("size-4", rating === 1 && "fill-current")} />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("rounded-full", rating === -1 && "text-brand")}
            aria-label="Respuesta no útil"
            aria-pressed={rating === -1}
            onClick={() => actions.rate(serverId, rating === -1 ? null : -1)}
          >
            <ThumbsDown className={cn("size-4", rating === -1 && "fill-current")} />
          </Button>
        </div>
      ) : null}
    </ActionBarPrimitive.Root>
  );
}

function AssistantMessage() {
  const sources = useMessageSources();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  return (
    <MessagePrimitive.Root className="animate-in fade-in-0 mt-5 flex flex-col duration-300">
      <SourcesProvider value={sources}>
        <RunSteps sourcesOpen={sourcesOpen} onToggleSources={() => setSourcesOpen((open) => !open)} />
        {sourcesOpen && sources.length > 0 ? (
          <div className="border-border bg-surface animate-in fade-in-0 mb-5 max-h-96 overflow-y-auto rounded-xl border px-4 duration-200">
            <SourcesList />
          </div>
        ) : null}
        <MessagePrimitive.Parts
          components={{
            Text: AssistantText,
            Reasoning: ReasoningPart,
            Source: () => null,
            tools: {
              Fallback: HiddenTool,
              by_name: {
                [OPENUI_TOOL_NAME]: OpenUIPresentTool,
                [OPENUI_PROMPT_TOOL_NAME]: OpenUIPromptTool,
              },
            },
          }}
        />
        <ApprovalCards />
        <MessageActions />
        <Related />
      </SourcesProvider>
    </MessagePrimitive.Root>
  );
}

export interface BackendOption {
  id: string;
  label: string;
  available: boolean;
}

export interface AgentOption {
  id: string;
  name: string;
  avatar: string;
}

export interface ChatThreadProps {
  isEmpty: boolean;
  loading: boolean;
  agentName?: string;
  projectName: string | null;
  onClearProject: () => void;
  modelLabel: string | null;
  starters?: string[];
  agents: AgentOption[];
  agentId: string | null;
  onAgentChange: (agentId: string | null) => void;
  focus: string;
  mode: "search" | "research";
  uiEnabled: boolean;
  backend: string;
  backends: BackendOption[];
  onFocusChange: (focus: string) => void;
  onModeChange: (mode: "search" | "research") => void;
  onUiChange: (enabled: boolean) => void;
  onBackendChange: (backend: string) => void;
  attachments: PendingAttachment[];
  uploading: boolean;
  uploadError: string | null;
  onFilesSelected: (files: FileList | null) => void;
  onRemoveAttachment: (index: number) => void;
}

export function ChatThread(props: ChatThreadProps) {
  const actions = useChatActions();
  const starters = props.starters ?? [];

  if (props.loading) {
    return (
      <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
        <div className="mx-auto w-full max-w-[760px] space-y-4 px-6 pt-10">
          <Skeleton className="h-8 w-2/3 rounded-lg" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </ThreadPrimitive.Root>
    );
  }

  if (props.isEmpty) {
    return (
      <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col overflow-y-auto">
        <div className="flex flex-1 flex-col items-center justify-center px-4 pb-[14vh]">
          <NexusLogo className="text-fg animate-in fade-in-0 zoom-in-95 size-10 duration-500" />
          {props.projectName ? (
            <button
              type="button"
              onClick={props.onClearProject}
              className="border-border text-muted-fg hover:text-fg mt-5 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px]"
            >
              <Folder className="size-3.5" /> {props.projectName} <X className="size-3.5" />
            </button>
          ) : null}
          <h1 className="mt-4 mb-8 text-center text-[28px] font-normal tracking-tight text-balance sm:text-[32px]">
            {props.agentName ? `Pregunta a ${props.agentName}` : "¿Qué quieres saber?"}
          </h1>
          <div className="w-full max-w-[700px]">
            <Composer
              {...props}
              autoFocus
              placeholder={
                props.mode === "research" ? "Describe la investigación que quieres…" : "Pregunta lo que quieras…"
              }
            />
          </div>
          {starters.length > 0 ? (
            <ul className="divide-border mt-6 w-full max-w-[700px] divide-y">
              {starters.map((starter) => (
                <li key={starter}>
                  <button
                    type="button"
                    onClick={() => actions.send(starter)}
                    className="text-muted-fg hover:text-fg flex w-full items-center gap-3 py-2.5 text-left text-[15px] transition-colors"
                  >
                    <Search className="size-4 shrink-0" /> {starter}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <footer className="text-muted-fg pb-4 text-center text-[12px]">Nexus · Tus claves, tus datos</footer>
      </ThreadPrimitive.Root>
    );
  }

  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col px-4 pt-4 pb-10 sm:px-6">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, EditComposer }} />
        </div>
      </ThreadPrimitive.Viewport>
      <div className="from-bg sticky bottom-0 bg-gradient-to-t from-60% to-transparent px-4 pt-6 pb-4">
        <div className="mx-auto w-full max-w-[760px]">
          <Composer {...props} placeholder="Haz una pregunta de seguimiento" />
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
}
