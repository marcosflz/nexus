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
  Sparkles,
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
  const { permissions } = useShell().user;
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
            className="text-muted-fg hover:text-fg size-8 shrink-0 rounded-full"
            aria-label="Añadir"
          >
            <Plus className="size-[18px]" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64 rounded-xl p-1.5">
          {permissions.attachments ? (
            <>
              <DropdownMenuItem disabled={props.uploading} onSelect={() => fileRef.current?.click()}>
                <Paperclip className="size-4" />
                <span className="flex flex-col leading-tight">
                  Subir archivos
                  <span className="text-muted-fg text-[11px]">PDF, DOCX, TXT, MD, CSV o JSON · máx. 10 MB</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : null}
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
          {permissions.generativeUi ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={props.uiEnabled} onCheckedChange={props.onUiChange}>
                <LayoutTemplate className="size-4" />
                <span className="flex flex-col leading-tight">
                  Forzar interfaz
                  <span className="text-muted-fg text-[11px]">Responder siempre con tablas, gráficos o tarjetas</span>
                </span>
              </DropdownMenuCheckboxItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

function SkillsPicker(props: ChatThreadProps) {
  const { user } = useShell();
  if (!user.permissions.skills) return null;
  const selected = props.selectedSkills ?? [];
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm" aria-label="Elegir skills" className="text-muted-fg shrink-0 gap-1"><Sparkles className="size-4" /><span className="hidden sm:inline">Skills</span>{selected.length ? <span className="text-xs">{selected.length}</span> : null}</Button></DropdownMenuTrigger><DropdownMenuContent className="max-h-80 w-72 overflow-y-auto" align="start" side="top"><DropdownMenuLabel>Activar en el próximo turno</DropdownMenuLabel>{props.skills?.length ? props.skills.map((skill) => <DropdownMenuCheckboxItem key={skill.name} checked={selected.includes(skill.name)} onCheckedChange={(checked) => props.onSkillsChange?.(checked ? [...selected, skill.name] : selected.filter((name) => name !== skill.name))}><span><span className="block">{skill.name}</span><span className="text-muted-fg line-clamp-2 text-xs">{skill.description}</span></span></DropdownMenuCheckboxItem>) : <p className="text-muted-fg px-2 py-3 text-xs">No hay skills disponibles para este chat o Nexbot.</p>}<DropdownMenuSeparator /><DropdownMenuItem asChild><Link href="/skills">Gestionar biblioteca</Link></DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function ModeSwitch({ mode, onChange }: { mode: "search" | "research"; onChange: (mode: "search" | "research") => void }) {
  const items = [
    { id: "search", label: "Búsqueda", icon: Search, tip: "Respuesta rápida con fuentes" },
    { id: "research", label: "Research", icon: Telescope, tip: "Informe a fondo: varias búsquedas y lecturas" },
  ] as const;
  return (
    <div role="group" aria-label="Modo" className="bg-bg/60 ring-border inline-flex shrink-0 items-center rounded-full p-0.5 ring-1">
      {items.map(({ id, label, icon: Icon, tip }) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-pressed={mode === id}
              onClick={() => onChange(id)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[14px] transition-colors max-sm:px-2.5",
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

const CHIP = "bg-brand-soft text-brand inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px]";

function ActiveChips(props: ChatThreadProps) {
  const { permissions } = useShell().user;
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
      {props.uiEnabled && permissions.generativeUi ? (
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

function modelLabelOf(groups: ChatThreadProps["modelGroups"], choice: { provider?: string; model?: string } | null) {
  if (!choice?.model) return null;
  const group = groups.find((g) => g.provider === choice.provider) ?? groups.find((g) => g.models.some((m) => m.id === choice.model));
  return group?.models.find((m) => m.id === choice.model)?.label ?? choice.model.split("/").pop() ?? choice.model;
}

/**
 * Agente y modelo del turno. Lista los modelos activos de todos los proveedores agrupados; si el
 * agente elegido fija su modelo, se muestra ese y el selector queda bloqueado.
 */
function ModelPicker(props: ChatThreadProps) {
  const shell = useShell();
  const activeAgent = props.agents.find((agent) => agent.id === props.agentId);
  const locked = Boolean(activeAgent && props.agentModel);
  const current = locked ? props.agentModel : props.selectedModel;
  const modelLabel = modelLabelOf(props.modelGroups, current);
  const agentLabel = activeAgent ? `${activeAgent.avatar ? `${activeAgent.avatar} ` : ""}${activeAgent.name}` : null;
  const label = agentLabel ? (modelLabel ? `${agentLabel} · ${modelLabel}` : agentLabel) : (modelLabel ?? "Nexus");
  const value = props.selectedModel ? `${props.selectedModel.provider}\u0000${props.selectedModel.model}` : "";
  const hasSubscriptions = props.modelGroups.some((g) => g.kind === "subscription");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          aria-label="Nexbot y modelo"
          className="text-muted-fg hover:text-fg h-8 min-w-0 shrink gap-1 rounded-full px-2.5 text-[14px]"
        >
          <span className="max-w-48 min-w-0 truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="max-h-[70svh] w-80 overflow-y-auto rounded-xl p-1.5">
        {shell.user.permissions.bots ? (
          <>
            <DropdownMenuLabel className="text-muted-fg text-[12px]">Nexbot</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={props.agentId ?? "__none"}
              onValueChange={(next) => props.onAgentChange(next === "__none" ? null : next)}
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
          </>
        ) : null}

        {locked ? (
          <p className="text-muted-fg px-2 py-1.5 text-[12px]">
            {activeAgent?.name} usa siempre {modelLabel ?? "su propio modelo"}.
          </p>
        ) : null}

        {props.modelGroups.length === 0 ? (
          <p className="text-muted-fg px-2 py-1.5 text-[13px]">No tienes modelos activos todavía.</p>
        ) : (
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              const [provider, model] = next.split("\u0000");
              if (provider && model) props.onModelChange({ provider, model });
            }}
          >
            {props.modelGroups.map((group) => (
              <div key={group.provider}>
                <DropdownMenuLabel className="text-muted-fg flex items-center justify-between text-[12px]">
                  <span>{group.label}</span>
                  {group.kind === "subscription" ? <span className="text-[11px] font-normal">Suscripción</span> : null}
                </DropdownMenuLabel>
                {group.models.map((model) => (
                  <DropdownMenuRadioItem
                    key={model.id}
                    value={`${group.provider}\u0000${model.id}`}
                    disabled={locked}
                    title={model.label !== model.id ? model.id : undefined}
                  >
                    <span className="truncate">{model.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </div>
            ))}
          </DropdownMenuRadioGroup>
        )}

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => shell.openSettings(hasSubscriptions || props.modelGroups.length === 0 ? "subscriptions" : "models")}>
          <Settings2 className="size-4" /> Gestionar modelos…
        </DropdownMenuItem>
        {shell.user.permissions.bots ? (
          <DropdownMenuItem asChild>
            <Link href="/bots">
              <Bot className="size-4" /> Gestionar Nexbots
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Composer(props: ChatThreadProps & { placeholder: string; autoFocus?: boolean }) {
  const { permissions } = useShell().user;
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
        <SkillsPicker {...props} />
        {permissions.research ? <ModeSwitch mode={props.mode} onChange={props.onModeChange} /> : null}
        <ActiveChips {...props} />
        {/* En pantallas estrechas solo encoge el nombre del modelo; el botón de enviar nunca se sale. */}
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <ModelPicker {...props} />
          {isRunning ? (
            <ComposerPrimitive.Cancel asChild>
              <Button
                size="icon"
                aria-label="Detener"
                className="bg-solid text-solid-fg hover:bg-solid/85 size-9 shrink-0 rounded-full"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send asChild>
              <Button
                size="icon"
                aria-label="Enviar"
                className="bg-solid text-solid-fg hover:bg-solid/85 size-9 shrink-0 rounded-full disabled:opacity-30"
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
