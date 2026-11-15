"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { Page } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BotStatusBadge } from "./status";

interface BotRow {
  id: string;
  name: string;
  description: string;
  status: string;
  lastError: string | null;
  environmentEnabled?: boolean;
}

async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

export function NewBotDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (bot: BotRow) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [desktop, setDesktop] = useState(true);
  const [environmentEnabled, setEnvironmentEnabled] = useState(false);
  const [persistBrowser, setPersistBrowser] = useState(false);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/bots", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        instructions,
        environmentEnabled,
        config: { desktop, persistBrowser, network: offline ? "none" : "restricted" },
      }),
    });
    setBusy(false);
    if (!res.ok) {
      setError(await errorOf(res, "No se pudo crear el bot"));
      return;
    }
    const data = (await res.json()) as { bot: BotRow };
    setName("");
    setDescription("");
    setInstructions("");
    onCreated(data.bot);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nuevo NexBot</DialogTitle>
            <DialogDescription>Define su identidad y añade un ordenador propio si lo necesita.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="bot-name">Nombre</Label>
            <Input id="bot-name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bot-description">Descripción</Label>
            <Input
              id="bot-description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bot-instructions">Instrucciones</Label>
            <Textarea
              id="bot-instructions"
              rows={3}
              maxLength={8000}
              placeholder="Quién es este bot y cómo debe trabajar"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Escritorio visible
              <span className="text-muted-fg block text-[12px]">Para observar en directo lo que hace.</span>
            </span>
            <Switch checked={desktop} onCheckedChange={setDesktop} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Conservar sesiones web
              <span className="text-muted-fg block text-[12px]">Guarda cookies en su volumen, sin cifrar.</span>
            </span>
            <Switch checked={persistBrowser} onCheckedChange={setPersistBrowser} />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              Sin internet
              <span className="text-muted-fg block text-[12px]">El bot no podrá salir a ninguna web.</span>
            </span>
            <Switch checked={offline} onCheckedChange={setOffline} />
          </label>
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : null}
          <label className="flex items-center justify-between text-sm">Ordenador propio (opcional)<Switch checked={environmentEnabled} onCheckedChange={setEnvironmentEnabled} /></label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : "Crear bot"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RoomRow {
  id: string;
  name: string;
  description: string;
  members: { id: string; name: string; slug: string; status: string }[];
  openTopics: number;
}

export function NewRoomDialog({
  bots,
  open,
  onOpenChange,
  onCreated,
}: {
  bots: BotRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (roomId: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [confirmMixed, setConfirmMixed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description, botIds: chosen, confirmMixedNetwork: confirmMixed }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
      setError(data.error ?? "No se pudo crear la sala");
      // El aviso de mezclar redes se acepta pulsando otra vez, ya informado.
      if (data.code === "mixed_network") setConfirmMixed(true);
      return;
    }
    window.dispatchEvent(new Event("nexus:rooms-changed"));
    onCreated(((await res.json()) as { room: { id: string } }).room.id);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Nueva sala</DialogTitle>
            <DialogDescription>Un espacio donde hablas con varios bots y ellos entre sí.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="new-room-name">Nombre</Label>
            <Input id="new-room-name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-room-description">Descripción</Label>
            <Input id="new-room-description" maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} />
          </div>
          {bots.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Bots</legend>
              {bots.map((bot) => (
                <label key={bot.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={chosen.includes(bot.id)}
                    onChange={(event) => {
                      setConfirmMixed(false);
                      setChosen((prev) => (event.target.checked ? [...prev, bot.id] : prev.filter((id) => id !== bot.id)));
                    }}
                  />
                  {bot.name}
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-muted-fg text-[13px]">Aún no tienes bots: podrás crearlos desde la sala.</p>
          )}
          {error ? (
            <p role="alert" className={confirmMixed ? "text-warning text-sm" : "text-danger text-sm"}>
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Creando…" : confirmMixed ? "Crear de todos modos" : "Crear sala"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BotsPage() {
  const router = useRouter();
  const [bots, setBots] = useState<BotRow[] | null>(null);
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingRoom, setCreatingRoom] = useState(false);

  const load = useCallback(async () => {
    const [botsRes, roomsRes] = await Promise.all([fetch("/api/bots"), fetch("/api/rooms")]);
    if (!botsRes.ok || !roomsRes.ok) {
      setLoadError(await errorOf(botsRes.ok ? roomsRes : botsRes, "No se pudieron cargar los bots"));
      return;
    }
    setBots(((await botsRes.json()) as { bots: BotRow[] }).bots);
    setRooms(((await roomsRes.json()) as { rooms: RoomRow[] }).rooms);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial desde la API
    void load();
  }, [load]);

  return (
    <Page
      title="NexBots"
      description="Salas donde diriges a tus bots, los ves trabajar y reparten el trabajo en un tablero."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" className="rounded-full" onClick={() => setCreating(true)}>
            <Plus className="size-4" /> Nuevo bot
          </Button>
          <Button className="rounded-full" onClick={() => setCreatingRoom(true)}>
            <Plus className="size-4" /> Nueva sala
          </Button>
        </div>
      }
    >
      {loadError ? (
        <p role="alert" className="text-danger text-sm">
          {loadError}
        </p>
      ) : bots === null || rooms === null ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : (
        <div className="grid gap-10">
          <section aria-labelledby="rooms-heading">
            <h2 id="rooms-heading" className="mb-3 text-[15px] font-medium">
              Salas
            </h2>
            {rooms.length === 0 ? (
              <p className="text-muted-fg text-sm">Crea una sala para hablar con varios bots a la vez y organizar su trabajo.</p>
            ) : (
              <ul className="divide-border border-border divide-y rounded-xl border">
                {rooms.map((room) => (
                  <li key={room.id}>
                    <Link href={`/bots/salas/${room.id}`} className="hover:bg-surface-2/60 flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{room.name}</span>
                        <span className="text-muted-fg block truncate text-[13px]">
                          {room.members.length === 0 ? "Sin bots" : room.members.map((member) => `@${member.slug}`).join(" ")}
                        </span>
                      </span>
                      <span className="text-muted-fg shrink-0 text-[13px]">
                        {room.openTopics} {room.openTopics === 1 ? "tarea abierta" : "tareas abiertas"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="bots-heading">
            <h2 id="bots-heading" className="mb-3 text-[15px] font-medium">
              Bots
            </h2>
            {bots.length === 0 ? (
              <p className="text-muted-fg text-sm">Todavía no tienes ningún bot.</p>
            ) : (
              <ul className="divide-border border-border divide-y rounded-xl border">
                {bots.map((bot) => (
                  <li key={bot.id}>
                    <Link href={`/bots/${bot.id}`} className="hover:bg-surface-2/60 flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{bot.name}</span>
                        <span className="text-muted-fg block truncate text-[13px]">
                          {bot.lastError ?? (bot.description || "Sin descripción")}
                        </span>
                      </span>
                      {bot.environmentEnabled ? <BotStatusBadge status={bot.status} /> : <span className="text-muted-fg text-xs">Sin ordenador</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
      <NewBotDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(bot) => {
          setCreating(false);
          setBots((prev) => (prev ? [bot, ...prev] : [bot]));
        }}
      />
      {creatingRoom ? (
        <NewRoomDialog bots={bots ?? []} open onOpenChange={setCreatingRoom} onCreated={(roomId) => router.push(`/bots/salas/${roomId}`)} />
      ) : null}
    </Page>
  );
}
