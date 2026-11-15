"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, KanbanSquare, Loader2, MessagesSquare, Plus, Settings2, UserMinus, X } from "lucide-react";
import { toast } from "sonner";
import { BotPanel } from "@/components/bots/bot-panel";
import { NewBotDialog } from "@/components/bots/bots-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { RoomLimits, TopicStatus } from "@/lib/db/schema";
import { TOPIC_LABEL } from "@/lib/rooms/spec";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import { Conversation } from "./conversation";
import { Kanban } from "./kanban";
import { errorOf, send, type Member, type Overview, type TopicCard } from "./types";

const POLL_MS = 3000;
const NONE = "none";

const LIST_WIDTH = 288;
/** Ancho mínimo útil de la conversación o del tablero. */
const CENTER_MIN = 440;
const PANEL_MIN = 340;
const PANEL_MAX = 900;
const PANEL_KEY = "nexus.room.panel-width";

/** Ancho real de la zona de trabajo: depende de la ventana y de si la barra lateral está abierta. */
function useWidth(): [number, (node: HTMLDivElement | null) => void] {
  const [width, setWidth] = useState(0);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [width, setNode];
}

function storedPanelWidth(): number {
  try {
    const value = Number(window.localStorage.getItem(PANEL_KEY));
    return value >= PANEL_MIN && value <= PANEL_MAX ? value : 480;
  } catch {
    return 480;
  }
}

/** Tirador del borde del panel: se arrastra o se mueve con las flechas. */
function PanelResizer({ width, max, onChange }: { width: number; max: number; onChange: (width: number) => void }) {
  const clamp = (value: number) => Math.round(Math.min(Math.max(value, PANEL_MIN), max));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Ancho del panel"
      aria-valuemin={PANEL_MIN}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      className="hover:bg-brand/40 focus-visible:bg-brand/60 border-border w-1.5 shrink-0 cursor-col-resize border-l outline-none"
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onChange(clamp(width + 32));
        if (event.key === "ArrowRight") onChange(clamp(width - 32));
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const move = (next: PointerEvent) => onChange(clamp(width + startX - next.clientX));
        const stop = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
      }}
    />
  );
}

function NewTopicDialog({
  roomId,
  members,
  open,
  onOpenChange,
  onCreated,
}: {
  roomId: string;
  members: Member[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (topicId: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [assignee, setAssignee] = useState(NONE);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const res = await send(`/api/rooms/${roomId}/topics`, "POST", { title, text, assigneeBotId: assignee === NONE ? null : assignee });
    setBusy(false);
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo crear el hilo"));
      return;
    }
    const data = (await res.json()) as { topic: { id: string } };
    setTitle("");
    setText("");
    setAssignee(NONE);
    onCreated(data.topic.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nuevo hilo</DialogTitle>
            <DialogDescription>Cada hilo es también una tarjeta del tablero.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="topic-title">Título</Label>
            <Input id="topic-title" required maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="topic-text">Primer mensaje</Label>
            <Textarea
              id="topic-text"
              rows={4}
              maxLength={20000}
              placeholder="Qué hay que hacer. Puedes mencionar a un bot con @"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="topic-assignee">Responsable</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger id="topic-assignee" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Sin responsable</SelectItem>
                {members.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-fg text-[12px]">Asignar la tarea a un bot le da un turno para empezarla.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear hilo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const LIMIT_FIELDS: { key: keyof RoomLimits; label: string; hint: string }[] = [
  { key: "maxHops", label: "Respuestas encadenadas", hint: "Veces seguidas que los bots pueden darse la palabra." },
  { key: "maxRunsPerRound", label: "Turnos por ronda", hint: "Turnos de bot que provoca un mensaje tuyo." },
  { key: "maxTokensPerRound", label: "Tokens por ronda", hint: "Gasto máximo antes de pedirte permiso." },
  { key: "maxStepsPerTurn", label: "Pasos por turno", hint: "Acciones de un bot en cada turno." },
];

function RoomSettingsDialog({
  overview,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: {
  overview: Overview;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const { room } = overview;
  const [name, setName] = useState(room.name);
  const [description, setDescription] = useState(room.description);
  const [limits, setLimits] = useState<Record<string, string>>(
    Object.fromEntries(LIMIT_FIELDS.map((field) => [field.key, String(room.limits[field.key])])),
  );
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const res = await send(`/api/rooms/${room.id}`, "PATCH", {
      name,
      description,
      limits: Object.fromEntries(LIMIT_FIELDS.map((field) => [field.key, Number(limits[field.key])])),
    });
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo guardar"));
      return;
    }
    toast.success("Sala guardada");
    window.dispatchEvent(new Event("nexus:rooms-changed"));
    onSaved();
    onOpenChange(false);
  }

  async function remove() {
    const res = await send(`/api/rooms/${room.id}`, "DELETE");
    if (!res.ok) toast.error(await errorOf(res, "No se pudo borrar la sala"));
    else {
      window.dispatchEvent(new Event("nexus:rooms-changed"));
      onDeleted();
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Ajustes de la sala</DialogTitle>
              <DialogDescription>Los límites cortan una conversación entre bots y te piden permiso para seguir.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="room-name">Nombre</Label>
              <Input id="room-name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="room-description">Descripción</Label>
              <Input id="room-description" maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {LIMIT_FIELDS.map((field) => (
                <div key={field.key} className="grid content-start gap-2">
                  <Label htmlFor={`limit-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`limit-${field.key}`}
                    type="number"
                    required
                    min={field.key === "maxHops" ? 0 : 1}
                    value={limits[field.key]}
                    onChange={(event) => setLimits((prev) => ({ ...prev, [field.key]: event.target.value }))}
                  />
                  <p className="text-muted-fg text-[12px]">{field.hint}</p>
                </div>
              ))}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button type="button" variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
                Borrar sala
              </Button>
              <Button type="submit">Guardar</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la sala {room.name}?</AlertDialogTitle>
            <AlertDialogDescription>Se borran sus hilos y mensajes. Los bots y sus archivos no se tocan.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function TopicList({ topics, members, selected, onSelect }: { topics: TopicCard[]; members: Member[]; selected: string | null; onSelect: (id: string) => void }) {
  if (topics.length === 0) return <p className="text-muted-fg px-3 py-4 text-sm">Todavía no hay hilos.</p>;
  return (
    <ul className="grid content-start gap-0.5 p-2">
      {topics.map((topic) => {
        const assignee = members.find((member) => member.id === topic.assigneeBotId);
        return (
          <li key={topic.id}>
            <button
              type="button"
              aria-current={selected === topic.id ? "true" : undefined}
              className={cn("hover:bg-surface-2/70 grid w-full gap-0.5 rounded-lg px-3 py-2 text-left", selected === topic.id && "bg-surface-2")}
              onClick={() => onSelect(topic.id)}
            >
              <span className="flex items-center gap-1.5">
                <span className="truncate text-[14px]">{topic.title}</span>
                {topic.activeBotId ? <Loader2 className="text-brand size-3 shrink-0 animate-spin" aria-label="Un bot está respondiendo" /> : null}
              </span>
              <span className="text-muted-fg truncate text-[12px]">
                {TOPIC_LABEL[topic.status]}
                {assignee ? ` · ${assignee.name}` : ""} · {topic.messages} {topic.messages === 1 ? "mensaje" : "mensajes"}
                {topic.held > 0 ? " · en pausa" : ""}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function RoomView({ roomId }: { roomId: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const topicId = params.get("hilo");
  const view = params.get("vista") === "kanban" ? "kanban" : "foro";
  const botId = params.get("bot");
  const [rowWidth, rowRef] = useWidth();
  const [panelWidth, setPanelWidth] = useState(480);
  useEffect(() => setPanelWidth(storedPanelWidth()), []);
  const resizePanel = useCallback((width: number) => {
    setPanelWidth(width);
    try {
      window.localStorage.setItem(PANEL_KEY, String(width));
    } catch {
      // Sin almacenamiento local el ancho simplemente no se recuerda.
    }
  }, []);
  // El panel se acopla si cabe junto a la conversación; si no, se abre por encima.
  const wide = rowWidth === 0 || rowWidth >= CENTER_MIN + PANEL_MIN;
  const panelMax = Math.max(PANEL_MIN, Math.min(PANEL_MAX, rowWidth - CENTER_MIN));
  const dockedWidth = Math.min(panelWidth, panelMax);

  const [overview, setOverview] = useState<Overview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allBots, setAllBots] = useState<{ id: string; name: string }[]>([]);
  const [newTopic, setNewTopic] = useState(false);
  const [newBot, setNewBot] = useState(false);
  const [settings, setSettings] = useState(false);
  const [mixed, setMixed] = useState<string | null>(null);

  const setQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null) next.delete(key);
        else next.set(key, value);
      }
      router.replace(`/bots/salas/${roomId}${next.size ? `?${next}` : ""}`, { scroll: false });
    },
    [params, roomId, router],
  );

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/rooms/${roomId}`);
    if (!res.ok) {
      setLoadError(await errorOf(res, "No se pudo cargar la sala"));
      return;
    }
    setLoadError(null);
    setOverview((await res.json()) as Overview);
  }, [roomId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const loadBots = useCallback(async () => {
    const res = await fetch("/api/bots");
    if (res.ok) setAllBots(((await res.json()) as { bots: { id: string; name: string }[] }).bots);
  }, []);

  async function addMember(id: string, confirmMixedNetwork = false) {
    const res = await send(`/api/rooms/${roomId}/members`, "POST", { botId: id, confirmMixedNetwork });
    if (res.status === 409 && ((await res.clone().json().catch(() => ({}))) as { code?: string }).code === "mixed_network") {
      setMixed(id);
      return;
    }
    if (!res.ok) toast.error(await errorOf(res, "No se pudo añadir el bot"));
    await refresh();
  }

  async function removeMember(id: string) {
    const res = await send(`/api/rooms/${roomId}/members?botId=${id}`, "DELETE");
    if (!res.ok) toast.error(await errorOf(res, "No se pudo quitar el bot"));
    setQuery({ bot: null });
    await refresh();
  }

  async function moveTopic(id: string, status: TopicStatus) {
    const res = await send(`/api/rooms/${roomId}/topics/${id}`, "PATCH", { status });
    if (!res.ok) toast.error(await errorOf(res, "No se pudo mover la tarjeta"));
    await refresh();
  }

  if (loadError) {
    return (
      <div className="p-8">
        <p role="alert" className="text-danger text-sm">
          {loadError}
        </p>
        <Link href="/bots" className="text-muted-fg mt-3 inline-block text-sm underline">
          Volver a NexBots
        </Link>
      </div>
    );
  }
  if (!overview) {
    return (
      <div className="p-8">
        <Skeleton className="h-96 w-full rounded-xl" />
      </div>
    );
  }

  const { room, members, topics } = overview;
  const topic = topics.find((item) => item.id === topicId) ?? null;
  const panelBot = members.find((member) => member.id === botId) ?? null;
  const outside = allBots.filter((bot) => !members.some((member) => member.id === bot.id));
  // Con el panel acoplado, la lista de hilos solo se queda si aún cabe la conversación.
  const listFits = !(panelBot && wide) || rowWidth - dockedWidth - LIST_WIDTH >= CENTER_MIN;
  const talking = new Set(topics.map((item) => item.activeBotId).filter(Boolean));

  const panel = panelBot ? (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="flex items-center gap-2">
        <BotAvatar member={panelBot} busy={talking.has(panelBot.id)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{panelBot.name}</p>
          <p className="text-muted-fg truncate text-[12px]">
            @{panelBot.slug} · {panelBot.network === "none" ? "Sin internet" : "Con internet"}
          </p>
        </div>
        <Button size="sm" variant="ghost" className="shrink-0" title="Quitar de la sala" onClick={() => void removeMember(panelBot.id)}>
          <UserMinus className="size-4" /> <span className="hidden sm:inline">Quitar</span>
        </Button>
        {wide ? (
          <Button size="icon" variant="ghost" className="size-8" aria-label="Cerrar panel" onClick={() => setQuery({ bot: null })}>
            <X className="size-4" />
          </Button>
        ) : null}
      </div>
      <BotPanel key={panelBot.id} botId={panelBot.id} compact />
    </div>
  ) : null;

  return (
    <div className="flex h-svh min-w-0 flex-col">
      <header className="border-border flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2.5">
        <SidebarTrigger className="md:hidden" />
        <Link href="/bots" aria-label="Volver a NexBots" className="text-muted-fg hover:text-fg">
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-medium">{room.name}</h1>
          {room.description ? <p className="text-muted-fg truncate text-[12px]">{room.description}</p> : null}
        </div>

        <ul className="flex flex-wrap items-center gap-1.5" aria-label="Bots de la sala">
          {members.map((member) => (
            <li key={member.id}>
              <button
                type="button"
                title={`${member.name} (@${member.slug})`}
                aria-label={`Abrir el panel de ${member.name}`}
                aria-pressed={botId === member.id}
                className={cn("flex items-center gap-1.5 rounded-full py-0.5 pr-2.5 pl-0.5 text-[13px]", botId === member.id ? "bg-surface-2" : "hover:bg-surface-2/60")}
                onClick={() => setQuery({ bot: botId === member.id ? null : member.id })}
              >
                <BotAvatar member={member} size="sm" busy={talking.has(member.id)} />@{member.slug}
              </button>
            </li>
          ))}
          <li>
            <DropdownMenu onOpenChange={(open) => open && void loadBots()}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="rounded-full">
                  <Plus className="size-4" /> Añadir bot
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuLabel>Tus bots</DropdownMenuLabel>
                {outside.length === 0 ? <p className="text-muted-fg px-2 py-1.5 text-[13px]">No hay más bots que añadir.</p> : null}
                {outside.map((bot) => (
                  <DropdownMenuItem key={bot.id} onSelect={() => void addMember(bot.id)}>
                    {bot.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setNewBot(true)}>Crear un bot nuevo…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        </ul>

        <div className="ml-auto flex items-center gap-1.5">
          <div role="tablist" aria-label="Vista" className="bg-surface-2/60 flex rounded-full p-0.5">
            {(
              [
                ["foro", "Foro", MessagesSquare],
                ["kanban", "Tablero", KanbanSquare],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                className={cn("flex items-center gap-1.5 rounded-full px-3 py-1 text-[13px]", view === value && "bg-bg shadow-xs")}
                onClick={() => setQuery({ vista: value === "kanban" ? "kanban" : null })}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          <Button size="sm" className="rounded-full" onClick={() => setNewTopic(true)}>
            <Plus className="size-4" /> Nuevo hilo
          </Button>
          <Button size="icon" variant="ghost" className="size-8" aria-label="Ajustes de la sala" onClick={() => setSettings(true)}>
            <Settings2 className="size-4" />
          </Button>
        </div>
      </header>

      <div ref={rowRef} className="flex min-h-0 min-w-0 flex-1">
        {view === "kanban" ? (
          <Kanban topics={topics} members={members} onOpen={(id) => setQuery({ hilo: id, vista: null })} onMove={(id, status) => void moveTopic(id, status)} />
        ) : (
          <>
            <nav
              aria-label="Hilos"
              className={cn(
                "border-border shrink-0 overflow-y-auto border-r",
                listFits ? "w-full md:w-72" : "w-full",
                topic && (listFits ? "hidden md:block" : "hidden"),
              )}
            >
              <TopicList topics={topics} members={members} selected={topicId} onSelect={(id) => setQuery({ hilo: id })} />
            </nav>
            {topic ? (
              <div className="flex min-w-0 flex-1 flex-col">
                <button
                  type="button"
                  className={cn("text-muted-fg px-4 pt-2 text-left text-[13px]", listFits && "md:hidden")}
                  onClick={() => setQuery({ hilo: null })}
                >
                  ← Hilos
                </button>
                <Conversation
                  key={topic.id}
                  roomId={roomId}
                  topic={topic}
                  topics={topics}
                  members={members}
                  onOpenBot={(id) => setQuery({ bot: id })}
                  onChanged={() => void refresh()}
                  onDeleted={() => {
                    setQuery({ hilo: null });
                    void refresh();
                  }}
                />
              </div>
            ) : (
              <div className={cn("text-muted-fg hidden flex-1 items-center justify-center p-8 text-center text-sm", listFits && "md:flex")}>
                {members.length === 0
                  ? "Añade un bot a la sala para empezar."
                  : "Elige un hilo o crea uno nuevo. Escribe @ para dirigirte a un bot."}
              </div>
            )}
          </>
        )}
        {panel && wide ? (
          <>
            <PanelResizer width={dockedWidth} max={panelMax} onChange={resizePanel} />
            <aside aria-label={`Panel de ${panelBot?.name}`} style={{ width: dockedWidth }} className="min-w-0 shrink-0 overflow-x-hidden overflow-y-auto p-4">
              {panel}
            </aside>
          </>
        ) : null}
      </div>

      {panel && !wide ? (
        <Sheet open onOpenChange={(open) => !open && setQuery({ bot: null })}>
          <SheetContent side="right" className="w-full overflow-x-hidden overflow-y-auto p-4 data-[side=right]:w-full data-[side=right]:sm:max-w-xl">
            <SheetHeader className="sr-only">
              <SheetTitle>{panelBot?.name}</SheetTitle>
              <SheetDescription>Panel del bot</SheetDescription>
            </SheetHeader>
            {panel}
          </SheetContent>
        </Sheet>
      ) : null}

      <NewTopicDialog
        roomId={roomId}
        members={members}
        open={newTopic}
        onOpenChange={setNewTopic}
        onCreated={(id) => {
          setNewTopic(false);
          setQuery({ hilo: id, vista: null });
          void refresh();
        }}
      />
      <NewBotDialog
        open={newBot}
        onOpenChange={setNewBot}
        onCreated={(bot) => {
          setNewBot(false);
          void addMember(bot.id);
        }}
      />
      {settings ? (
        <RoomSettingsDialog overview={overview} open onOpenChange={setSettings} onSaved={() => void refresh()} onDeleted={() => router.push("/bots")} />
      ) : null}
      <AlertDialog open={mixed !== null} onOpenChange={(open) => !open && setMixed(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vas a mezclar bots con y sin internet</AlertDialogTitle>
            <AlertDialogDescription>
              Los bots de una sala leen lo que escriben los demás. Un bot sin internet podría pasar sus datos a otro que sí tiene salida, y este enviarlos fuera.
              Añádelo solo si lo que maneja el bot aislado puede salir.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = mixed;
                setMixed(null);
                if (id) void addMember(id, true);
              }}
            >
              Añadir de todos modos
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
