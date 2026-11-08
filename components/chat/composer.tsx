"use client";

import Link from "next/link";
import { useRef } from "react";
import { ComposerPrimitive, useAuiState } from "@assistant-ui/react";
import {
  ArrowUp,
  Bot,
  ChevronDown,
  ChartLine,
  FileText,
  GraduationCap,
  Globe,
  LayoutTemplate,
  Loader2,
  MessagesSquare,
  Newspaper,
  Paperclip,
  Plus,
  Search,
  Settings2,
  Square,
  Telescope,
  X,
  type LucideIcon,
} from "lucide-react";
import { NexusLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useShell } from "@/components/shell/shell-context";
import { FOCUS_OPTIONS } from "@/lib/focus";
import { cn } from "@/lib/utils";
import type { ChatThreadProps } from "./thread";

const FOCUS_ICONS: Record<string, LucideIcon> = {
  web: Globe,
  academic: GraduationCap,
  reddit: MessagesSquare,
  finance: ChartLine,
  news: Newspaper,
};

function PlusMenu(props: ChatThreadProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,.log"
        disabled={props.uploading}
        onChange={(event) => {
          props.onFilesSelected(event.target.files);
          event.target.value = "";
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-fg hover:text-fg size-8 rounded-full"
            aria-label="Añadir"
          >
            <Plus className="size-[18px]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64 rounded-xl p-1.5">
          <DropdownMenuItem disabled={props.uploading} onSelect={() => fileRef.current?.click()}>
            <Paperclip className="size-4" />
            <span className="flex flex-col leading-tight">
              Subir archivos
              <span className="text-muted-fg text-[11px]">PDF, DOCX, TXT, MD, CSV o JSON · máx. 10 MB</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-muted-fg text-[12px]">Fuentes</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={props.focus} onValueChange={props.onFocusChange}>
            {FOCUS_OPTIONS.map((option) => {
              const Icon = FOCUS_ICONS[option.id] ?? Globe;
              return (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  <Icon className="size-4" /> {option.label}
                </DropdownMenuRadioItem>
              );
            })}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem checked={props.uiEnabled} onCheckedChange={props.onUiChange}>
            <LayoutTemplate className="size-4" />
            <span className="flex flex-col leading-tight">
              Interfaz generativa
              <span className="text-muted-fg text-[11px]">Tablas, gráficos, mapas y formularios</span>
            </span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function ModeSwitch({ mode, onChange }: { mode: "search" | "research"; onChange: (mode: "search" | "research") => void }) {
  const items = [
    { id: "search", label: "Búsqueda", icon: Search, tip: "Respuesta rápida con fuentes" },
    { id: "research", label: "Research", icon: Telescope, tip: "Informe a fondo: varias búsquedas y lecturas" },
  ] as const;
  return (
    <div role="group" aria-label="Modo" className="bg-bg/60 ring-border inline-flex items-center rounded-full p-0.5 ring-1">
      {items.map(({ id, label, icon: Icon, tip }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={mode === id}
              onClick={() => onChange(id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] transition-colors",
                mode === id ? "bg-surface-2 text-fg ring-border-strong ring-1" : "text-muted-fg hover:text-fg",
              )}
            >
              <Icon className="size-4" />
              <span className="max-sm:hidden">{label}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{tip}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

const CHIP = "bg-brand-soft text-brand inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-[13px]";

function ActiveChips(props: ChatThreadProps) {
  const FocusIcon = FOCUS_ICONS[props.focus] ?? Globe;
  const focusLabel = FOCUS_OPTIONS.find((o) => o.id === props.focus)?.label;
  return (
    <>
      {props.focus !== "web" ? (
        <span className={CHIP}>
          <FocusIcon className="size-3.5" />
          <span className="max-sm:hidden">{focusLabel}</span>
          <button type="button" aria-label="Quitar fuente" onClick={() => props.onFocusChange("web")}>
            <X className="size-3.5" />
          </button>
        </span>
      ) : null}
      {props.uiEnabled ? (
        <span className={CHIP}>
          <LayoutTemplate className="size-3.5" />
          <span className="max-sm:hidden">Interfaz</span>
          <button type="button" aria-label="Quitar interfaz generativa" onClick={() => props.onUiChange(false)}>
            <X className="size-3.5" />
          </button>
        </span>
      ) : null}
    </>
  );
}

function ModelPicker(props: ChatThreadProps) {
  const shell = useShell();
  const activeAgent = props.agents.find((agent) => agent.id === props.agentId);
  const label = activeAgent
    ? `${activeAgent.avatar ? `${activeAgent.avatar} ` : ""}${activeAgent.name}`
    : (props.modelLabel ?? "Nexus");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label="Agente y modelo"
          className="text-muted-fg hover:text-fg h-8 gap-1 rounded-full px-2.5 text-[14px]"
        >
          <span className="max-w-40 truncate">{label}</span>
          <ChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-72 rounded-xl p-1.5">
        <DropdownMenuLabel className="text-muted-fg text-[12px]">Agente</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={props.agentId ?? "__none"}
          onValueChange={(value) => props.onAgentChange(value === "__none" ? null : value)}
        >
          <DropdownMenuRadioItem value="__none">
            <NexusLogo className="size-4" /> Nexus
          </DropdownMenuRadioItem>
          {props.agents.map((agent) => (
            <DropdownMenuRadioItem key={agent.id} value={agent.id}>
              {agent.avatar ? <span>{agent.avatar}</span> : null} {agent.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => shell.openSettings("models")}>
          <Settings2 className="size-4" /> Cambiar modelo…
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/agents">
            <Bot className="size-4" /> Gestionar agentes
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Composer(props: ChatThreadProps & { placeholder: string; autoFocus?: boolean }) {
  const isRunning = useAuiState((state) => state.thread.isRunning);
  const { attachments, uploading, uploadError } = props;
  const hasRow = attachments.length > 0 || uploading || uploadError;

  return (
    <ComposerPrimitive.Root className="border-border bg-surface shadow-1 focus-within:border-border-strong focus-within:shadow-2 flex w-full flex-col rounded-2xl border transition-[border-color,box-shadow] duration-200">
      {hasRow ? (
        <div className="flex flex-wrap gap-2 px-3 pt-3">
          {attachments.map((attachment, index) => (
            <span
              key={`${attachment.name}-${index}`}
              className="border-border bg-surface-2 inline-flex max-w-60 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs"
            >
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate" title={attachment.name}>
                {attachment.name}
                {attachment.truncated ? " (recortado)" : ""}
              </span>
              <button
                type="button"
                onClick={() => props.onRemoveAttachment(index)}
                className="text-muted-fg hover:text-danger"
                aria-label={`Quitar ${attachment.name}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {uploading ? (
            <span className="border-border bg-surface-2 inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs">
              <Loader2 className="size-3 animate-spin" /> Subiendo…
            </span>
          ) : null}
          {uploadError ? <span className="text-danger text-xs">{uploadError}</span> : null}
        </div>
      ) : null}
      <ComposerPrimitive.Input
        rows={1}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        className="text-fg placeholder:text-muted-fg max-h-60 min-h-[56px] w-full resize-none bg-transparent px-4 pt-4 pb-1 text-[16px] leading-6 outline-none"
      />
      <div className="flex items-center gap-1.5 px-2.5 pt-1 pb-2.5">
        <PlusMenu {...props} />
        <ModeSwitch mode={props.mode} onChange={props.onModeChange} />
        <ActiveChips {...props} />
        <div className="ml-auto flex items-center gap-1">
          <ModelPicker {...props} />
          {isRunning ? (
            <ComposerPrimitive.Cancel asChild>
              <Button
                size="icon"
                aria-label="Detener"
                className="bg-solid text-solid-fg hover:bg-solid/85 size-9 rounded-full"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send asChild>
              <Button
                size="icon"
                aria-label="Enviar"
                className="bg-solid text-solid-fg hover:bg-solid/85 size-9 rounded-full disabled:opacity-30"
              >
                <ArrowUp className="size-[18px]" />
              </Button>
            </ComposerPrimitive.Send>
          )}
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
}
