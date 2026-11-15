"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useAuiState, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import {
  BookOpen,
  Brain,
  Check,
  ChevronDown,
  FileText,
  Globe,
  LayoutTemplate,
  Loader2,
  Search,
  ShieldQuestion,
  Wrench,
  X,
} from "lucide-react";
import { createContext, useContext } from "react";
import { Markdown } from "@/components/ui/markdown";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ui/reasoning";
import { describeStep } from "@/components/rooms/tool-steps";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { Button } from "@/components/ui/button";
import { citationIdsOf, remarkCitations, stripSourcesBlock } from "@/lib/markdown/citations";
import { domainOf, shortDomain } from "@/lib/sources";
import { cn } from "@/lib/utils";
import { DomainInitial } from "./source-cards";
import { useChatActions, type MessageCustom } from "./chat-context";

export interface PartSource {
  id: number;
  url: string;
  title?: string;
}

const SourcesContext = createContext<PartSource[]>([]);
export const SourcesProvider = SourcesContext.Provider;

const REMARK_PLUGINS = [remarkCitations];

/** Fuentes de un mensaje (las partes `source` de assistant-ui), numeradas. */
export function useMessageSources(): PartSource[] {
  const content = useAuiState((state) => state.message.content);
  return useMemo(
    () =>
      (content as readonly { type: string; id?: string; url?: string; title?: string }[])
        .filter((part) => part.type === "source" && part.url)
        .map((part, index) => ({
          id: Number(part.id) || index + 1,
          url: part.url as string,
          title: part.title,
        })),
    [content],
  );
}

/**
 * Chip de cita al estilo Perplexity: «dominio +N». Al pasar el ratón muestra
 * todas las fuentes que agrupa.
 */
export function CitationChip({ ids, sources }: { ids: number[]; sources: PartSource[] }) {
  const cited = ids
    .map((id) => sources.find((item) => item.id === id))
    .filter((item): item is PartSource => Boolean(item));
  if (cited.length === 0) {
    return <span className="text-muted-fg font-mono text-[11px]">[{ids.join(",")}]</span>;
  }
  const [first] = cited;
  const label = shortDomain(first.url) || domainOf(first.url) || String(first.id);
  return (
    <HoverCard openDelay={120} closeDelay={60}>
      <HoverCardTrigger asChild>
        <a
          href={first.url}
          target="_blank"
          rel="noopener noreferrer"
          className="bg-surface-2 text-muted-fg hover:bg-surface-3 hover:text-fg mx-0.5 inline-flex h-[19px] max-w-40 items-center gap-1 rounded-md px-1.5 align-[2px] font-mono text-[11px] leading-none no-underline! transition-colors"
        >
          <span className="truncate">{label}</span>
          {cited.length > 1 ? <span className="shrink-0 opacity-70">+{cited.length - 1}</span> : null}
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="shadow-2 w-80 rounded-xl p-1.5 font-sans">
        <ul className="flex flex-col">
          {cited.map((source) => (
            <li key={source.id}>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:bg-surface-2 flex flex-col gap-1 rounded-lg p-2 no-underline"
              >
                <span className="text-muted-fg flex items-center gap-1.5 text-[12px]">
                  <DomainInitial url={source.url} /> {domainOf(source.url)}
                  <span className="ml-auto tabular-nums">{source.id}</span>
                </span>
                <span className="text-fg line-clamp-2 text-[13px] leading-snug font-medium">
                  {source.title ?? source.url}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}

/** Texto del asistente con citas [n] interactivas y sin la lista final de fuentes. */
export function AssistantText() {
  const text = useAuiState((state) => (state.part.type === "text" ? state.part.text : ""));
  const sources = useContext(SourcesContext);

  const components = useMemo(
    () => ({
      a: function Anchor({ href, children }: { href?: string; children?: ReactNode }) {
        const ids = citationIdsOf(href);
        if (ids.length > 0) return <CitationChip ids={ids} sources={sources} />;
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [sources],
  );

  const shown = sources.length > 0 ? stripSourcesBlock(text) : text;
  if (!shown) return null;
  return (
    <Markdown className="aui-md" remarkPlugins={REMARK_PLUGINS} components={components}>
      {shown}
    </Markdown>
  );
}

export function UserText() {
  const text = useAuiState((state) => (state.part.type === "text" ? state.part.text : ""));
  return <span className="whitespace-pre-wrap">{text}</span>;
}

export function ReasoningPart() {
  const text = useAuiState((state) => (state.part.type === "reasoning" ? state.part.text : ""));
  const running = useAuiState((state) => state.message.status?.type === "running");
  // Mientras trabaja, el estado ya se ve en la cabecera («Pensando…»); el razonamiento se ofrece al terminar.
  if (!text || running) return null;
  return (
    <Reasoning className="my-3">
      <ReasoningTrigger className="text-muted-fg text-[13px]">Razonamiento</ReasoningTrigger>
      <ReasoningContent markdown>{text}</ReasoningContent>
    </Reasoning>
  );
}

/** Lista de todas las páginas consultadas (se despliega desde «N fuentes»). */
export function SourcesList() {
  const sources = useContext(SourcesContext);
  return (
    <ol className="divide-border divide-y">
      {sources.map((s) => (
        <li key={s.id}>
          <a href={s.url} target="_blank" rel="noopener noreferrer" className="group flex gap-3 py-4">
            <span className="bg-surface-2 text-muted-fg flex size-6 shrink-0 items-center justify-center rounded-full text-[12px] tabular-nums">
              {s.id}
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-muted-fg flex items-center gap-1.5 text-[12px]">
                <DomainInitial url={s.url} /> {domainOf(s.url)}
              </span>
              <span className="text-fg mt-1 line-clamp-2 block text-[15px] font-medium group-hover:underline">
                {s.title ?? s.url}
              </span>
              <span className="text-muted-fg mt-0.5 block truncate text-[12px]">{s.url}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
}

/** Las herramientas no se pintan en línea: se resumen en `RunSteps`. */
export const HiddenTool: ToolCallMessagePartComponent = () => null;

interface StepPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  result?: unknown;
  isError?: boolean;
}

/** Herramientas que no son «pasos»: la interfaz y los seguimientos se ven por sí mismos. */
const NOT_STEPS = new Set(["present_openui", "prompt_openui", "suggest_followups"]);
const SEARCH_TOOLS = new Set(["web_search"]);
const READ_TOOLS = new Set(["web_fetch", "web_extract"]);

function argText(step: StepPart, ...keys: string[]): string {
  for (const key of keys) {
    const value = step.args?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length > 0) return value.map(String).join(", ");
  }
  return "";
}

function stepRunning(step: StepPart, messageRunning: boolean) {
  return messageRunning && step.result === undefined;
}

function runningLabel(step: StepPart): string {
  if (SEARCH_TOOLS.has(step.toolName)) return `Buscando «${argText(step, "query") || "…"}»`;
  if (READ_TOOLS.has(step.toolName)) {
    const url = argText(step, "url", "urls");
    return `Leyendo ${domainOf(url) || url || "la página"}`;
  }
  if (step.toolName === "openui_spec") return "Preparando la interfaz…";
  if (step.toolName === "knowledge_search") return "Consultando tu base de conocimiento…";
  return "Trabajando…";
}

function otherStepInfo(step: StepPart): { icon: ReactNode; label: string } {
  switch (step.toolName) {
    case "openui_spec":
      return { icon: <LayoutTemplate className="size-3.5" />, label: "Componentes de interfaz" };
    case "knowledge_search":
      return {
        icon: <BookOpen className="size-3.5" />,
        label: `Base de conocimiento: ${argText(step, "query") || "…"}`,
      };
    case "remember":
    case "recall":
    case "forget":
      return { icon: <Brain className="size-3.5" />, label: "Memoria" };
    default:
      // Las acciones de un NexBot se describen en claro («Clic en (x, y)», «Guarda …»).
      return {
        icon: <Wrench className="size-3.5" />,
        label: describeStep({ id: step.toolCallId, name: step.toolName, input: step.args, status: "complete" }),
      };
  }
}

function StepState({ running, error }: { running: boolean; error?: boolean }) {
  if (running) return <Loader2 className="text-brand size-3 shrink-0 animate-spin" />;
  if (error) return <X className="text-danger size-3 shrink-0" />;
  return null;
}

function StepList({ steps, running }: { steps: StepPart[]; running: boolean }) {
  const searches = steps.filter((step) => SEARCH_TOOLS.has(step.toolName));
  const reads = steps.filter((step) => READ_TOOLS.has(step.toolName));
  const others = steps.filter((step) => !SEARCH_TOOLS.has(step.toolName) && !READ_TOOLS.has(step.toolName));
  const chip = "bg-surface-2 text-fg inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]";

  return (
    <div className="border-border animate-in fade-in-0 mt-3 ml-[7px] flex flex-col gap-4 border-l pb-1 pl-4 duration-200">
      {searches.length > 0 ? (
        <div>
          <div className="text-muted-fg mb-2 flex items-center gap-1.5 text-[12px]">
            <Search className="size-3.5" /> Búsquedas
          </div>
          <div className="flex flex-wrap gap-1.5">
            {searches.map((step) => (
              <span key={step.toolCallId} className={chip}>
                <Search className="text-muted-fg size-3 shrink-0" />
                <span className="truncate">{argText(step, "query") || "…"}</span>
                <StepState running={stepRunning(step, running)} error={step.isError} />
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {reads.length > 0 ? (
        <div>
          <div className="text-muted-fg mb-2 flex items-center gap-1.5 text-[12px]">
            <Globe className="size-3.5" /> Páginas leídas
          </div>
          <div className="flex flex-wrap gap-1.5">
            {reads.map((step) => {
              const url = argText(step, "url", "urls");
              return (
                <a
                  key={step.toolCallId}
                  href={url || undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={url}
                  className={cn(chip, "hover:bg-surface-3 transition-colors")}
                >
                  {url ? <DomainInitial url={url} /> : <FileText className="size-3 shrink-0" />}
                  <span className="truncate">{domainOf(url) || url || "…"}</span>
                  <StepState running={stepRunning(step, running)} error={step.isError} />
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
      {others.map((step) => {
        const info = otherStepInfo(step);
        const busy = stepRunning(step, running);
        return (
          <div key={step.toolCallId} className="text-muted-fg flex items-center gap-2 text-[13px]">
            {info.icon}
            <span className="truncate">{info.label}</span>
            {busy || step.isError ? (
              <StepState running={busy} error={step.isError} />
            ) : (
              <Check className="size-3 shrink-0" />
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Cabecera de la respuesta al estilo Perplexity: «Finalizado · N pasos» (plegable
 * con las búsquedas y lecturas) y, a la derecha, «N fuentes». Mientras el run
 * trabaja, los pasos se ven en directo; al terminar se pliegan.
 */
export function RunSteps({
  sourcesOpen,
  onToggleSources,
}: {
  sourcesOpen: boolean;
  onToggleSources: () => void;
}) {
  const content = useAuiState((state) => state.message.content);
  const statusType = useAuiState((state) => state.message.status?.type);
  const sources = useContext(SourcesContext);
  const [toggled, setToggled] = useState<boolean | null>(null);

  const steps = useMemo(
    () =>
      (content as readonly { type: string; toolName?: string }[]).filter(
        (part): part is StepPart => part.type === "tool-call" && !NOT_STEPS.has(part.toolName ?? ""),
      ),
    [content],
  );
  const hasText = useMemo(
    () => content.some((part) => part.type === "text" && Boolean((part as { text?: string }).text?.trim())),
    [content],
  );

  const running = statusType === "running";
  if (!running && steps.length === 0 && sources.length === 0) return null;

  const open = toggled ?? (running && !hasText);
  const current = running ? [...steps].reverse().find((step) => step.result === undefined) : undefined;

  let label: ReactNode;
  if (running) {
    const text = current
      ? runningLabel(current)
      : hasText
        ? "Redactando la respuesta…"
        : steps.length > 0
          ? "Analizando los resultados…"
          : "Pensando…";
    label = <TextShimmer className="text-[13px]">{text}</TextShimmer>;
  } else if (statusType === "requires-action") {
    label = "Esperando tu respuesta";
  } else if (statusType === "incomplete") {
    label = "Interrumpido";
  } else {
    label = "Finalizado";
  }

  return (
    <div className="mb-4">
      <div className="flex min-h-7 items-center justify-between gap-3">
        <button
          type="button"
          disabled={steps.length === 0}
          aria-expanded={steps.length > 0 ? open : undefined}
          onClick={() => setToggled(!open)}
          className="text-muted-fg enabled:hover:text-fg inline-flex min-w-0 items-center gap-1.5 text-[13px] transition-colors"
        >
          <span className="truncate">{label}</span>
          {steps.length > 0 && !running ? (
            <span className="shrink-0">
              · {steps.length} {steps.length === 1 ? "paso" : "pasos"}
            </span>
          ) : null}
          {steps.length > 0 ? (
            <ChevronDown className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")} />
          ) : null}
        </button>
        {sources.length > 0 ? (
          <button
            type="button"
            onClick={onToggleSources}
            aria-expanded={sourcesOpen}
            className={cn(
              "border-border text-muted-fg hover:text-fg hover:bg-surface-2 inline-flex shrink-0 items-center gap-2 rounded-full border py-1 pr-3 pl-1.5 text-[12px] transition-colors",
              sourcesOpen && "bg-surface-2 text-fg",
            )}
          >
            <span className="flex -space-x-1">
              {sources.slice(0, 3).map((source) => (
                <DomainInitial key={source.id} url={source.url} ring />
              ))}
            </span>
            {sources.length} {sources.length === 1 ? "fuente" : "fuentes"}
          </button>
        ) : null}
      </div>
      {open && steps.length > 0 ? <StepList steps={steps} running={running} /> : null}
    </div>
  );
}

/** Tarjeta de aprobación: la herramienta espera un sí o un no de la persona. */
export function ApprovalCards() {
  const custom = useAuiState((state) => state.message.metadata?.custom) as MessageCustom | undefined;
  const actions = useChatActions();
  const approvals = (custom?.interrupts ?? []).filter((item) => item.reason === "approval");
  if (approvals.length === 0 || !custom?.runId) return null;
  const runId = custom.runId;

  return (
    <div className="my-3 flex flex-col gap-2">
      {approvals.map((item) => {
        const reason = typeof item.payload?.reason === "string" ? item.payload.reason : null;
        const args = item.args && typeof item.args === "object" ? JSON.stringify(item.args, null, 2) : null;
        return (
          <div key={item.id} className="border-warning/40 bg-warning/10 rounded-xl border p-4 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <ShieldQuestion className="size-4" />
              El agente quiere ejecutar <code className="bg-muted rounded px-1">{item.toolName}</code>
            </div>
            {reason ? <p className="text-muted-foreground mt-1">{reason}</p> : null}
            {args ? (
              <pre className="bg-muted mt-2 max-h-40 overflow-auto rounded-lg p-2 text-xs">{args}</pre>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                className="rounded-full"
                onClick={() =>
                  actions.resume(runId, [
                    { callId: item.toolCallId ?? "", status: "approved", approvalId: item.id },
                  ])
                }
              >
                Aprobar
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-full"
                onClick={() =>
                  actions.resume(runId, [
                    {
                      callId: item.toolCallId ?? "",
                      status: "denied",
                      reason: "Rechazado por el usuario",
                      approvalId: item.id,
                    },
                  ])
                }
              >
                Rechazar
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
