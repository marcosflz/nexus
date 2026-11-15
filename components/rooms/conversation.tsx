"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { TopicStatus } from "@/lib/db/schema";
import { TOPIC_LABEL, TOPIC_STATUSES } from "@/lib/rooms/spec";
import { BotAvatar } from "./bot-avatar";
import { RoomComposer } from "./composer";
import { ReasoningNote } from "./reasoning-note";
import { ToolSteps } from "./tool-steps";
import { errorOf, send, type Member, type RoomMessage, type TopicCard, type TopicDetail, type TurnInfo } from "./types";
import { useLiveRun } from "./use-live-run";

const TIME = new Intl.DateTimeFormat("es-ES", { hour: "2-digit", minute: "2-digit" });
const POLL_MS = 2000;
const NONE = "none";

function BotMessage({
  member,
  time,
  running,
  onOpenBot,
  children,
}: {
  member: Member | undefined;
  time?: string;
  running?: boolean;
  onOpenBot: (botId: string) => void;
  children: React.ReactNode;
}) {
  const fallback = { name: "Bot", avatar: "", status: "stopped" };
  return (
    <article className="flex gap-3">
      <button type="button" className="mt-0.5 self-start" aria-label={`Abrir el panel de ${member?.name ?? "bot"}`} onClick={() => member && onOpenBot(member.id)}>
        <BotAvatar member={member ?? fallback} busy={running} />
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
          <button type="button" className="font-medium hover:underline" onClick={() => member && onOpenBot(member.id)}>
            {member?.name ?? "Bot que ya no está en la sala"}
          </button>
          {member ? <span className="text-muted-fg">@{member.slug}</span> : null}
          {time ? <span className="text-muted-fg text-[12px]">{time}</span> : null}
          {running ? <Loader2 className="text-brand size-3 animate-spin self-center" aria-label="Respondiendo" /> : null}
        </p>
        {children}
      </div>
    </article>
  );
}

function LiveTurn({ turn, member, onOpenBot }: { turn: TurnInfo; member: Member | undefined; onOpenBot: (botId: string) => void }) {
  const message = useLiveRun(turn.runId);
  return (
    <BotMessage member={member} running onOpenBot={onOpenBot}>
      {turn.status === "awaiting" ? <p className="text-warning text-[13px]">Espera tu aprobación en la Bandeja.</p> : null}
      <ToolSteps calls={message?.tools ?? []} />
      {message?.content ? <Markdown className="text-[15px]">{message.content}</Markdown> : <p className="text-muted-fg text-[14px]">Trabajando…</p>}
    </BotMessage>
  );
}

function Notice({
  message,
  member,
  canContinue,
  onContinue,
  onStart,
}: {
  message: RoomMessage;
  member: Member | undefined;
  canContinue: boolean;
  onContinue: () => void;
  onStart: (botId: string) => void;
}) {
  const kind = message.notice?.kind;
  return (
    <div role="status" className="border-border text-muted-fg mx-auto flex max-w-xl flex-wrap items-center justify-center gap-3 rounded-xl border border-dashed px-4 py-2.5 text-center text-[13px]">
      <span>{message.content}</span>
      {kind === "limit" && canContinue ? (
        <Button size="sm" variant="outline" onClick={onContinue}>
          Continuar
        </Button>
      ) : null}
      {kind === "bot_stopped" && member && member.status !== "running" ? (
        <Button size="sm" variant="outline" onClick={() => onStart(member.id)}>
          Arrancar a {member.name}
        </Button>
      ) : null}
    </div>
  );
}

export function Conversation({
  roomId,
  topic,
  topics,
  members,
  onOpenBot,
  onChanged,
  onDeleted,
}: {
  roomId: string;
  topic: TopicCard;
  topics: TopicCard[];
  members: Member[];
  onOpenBot: (botId: string) => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const base = `/api/rooms/${roomId}/topics/${topic.id}`;
  const [detail, setDetail] = useState<TopicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const memberOf = (botId: string | null | undefined) => members.find((member) => member.id === botId);

  const refresh = useCallback(async () => {
    const res = await fetch(base);
    if (!res.ok) {
      setError(await errorOf(res, "No se pudo cargar el hilo"));
      return;
    }
    setError(null);
    setDetail((await res.json()) as TopicDetail);
  }, [base]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const count = detail?.messages.length ?? 0;
  const activeTurn = detail?.turns.find((turn) => turn.status === "running" || turn.status === "awaiting");
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count, activeTurn?.id]);

  async function act(request: Promise<Response>, fallback: string): Promise<boolean> {
    const res = await request;
    if (!res.ok) {
      toast.error(await errorOf(res, fallback));
      return false;
    }
    await refresh();
    onChanged();
    return true;
  }

  const patch = (body: Record<string, unknown>) => act(send(base, "PATCH", body), "No se pudo guardar el cambio");
  const round = (action: "stop" | "continue") => act(send(`${base}/round`, "POST", { action }), "No se pudo aplicar");

  async function startBot(botId: string) {
    const res = await send(`/api/bots/${botId}/lifecycle`, "POST", { action: "start" });
    if (!res.ok) toast.error(await errorOf(res, "No se pudo arrancar el bot"));
    else toast.success("Bot en marcha. Vuelve a escribirle cuando quieras.");
    onChanged();
  }

  async function remove() {
    if (!window.confirm(`¿Borrar el hilo «${topic.title}» con todos sus mensajes?`)) return;
    const res = await send(base, "DELETE");
    if (!res.ok) toast.error(await errorOf(res, "No se pudo borrar el hilo"));
    else onDeleted();
  }

  const assignee = memberOf(topic.assigneeBotId);
  const queued = detail?.turns.filter((turn) => turn.status === "queued") ?? [];
  const held = detail?.turns.filter((turn) => turn.status === "held") ?? [];
  const busy = Boolean(activeTurn) || queued.length > 0;
  const parent = topics.find((item) => item.id === topic.parentTopicId);
  const pendingBlockers = topic.blockedBy.filter((blocker) => !blocker.resolved);
  // El mensaje guardado sustituye a la vista en directo en cuanto existe.
  const showLive = activeTurn && !detail?.messages.some((message) => message.runId === activeTurn.runId && message.role === "assistant");

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label={`Hilo ${topic.title}`}>
      <header className="border-border flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <div className="min-w-40 flex-1">
          <h2 className="truncate text-[16px] font-medium">{topic.title}</h2>
          <p className="text-muted-fg truncate text-[12px]">
            {parent ? `Subtarea de «${parent.title}»` : "Hilo"}
            {pendingBlockers.length > 0
              ? ` · Bloqueado por ${pendingBlockers.map((blocker) => `«${topics.find((item) => item.id === blocker.id)?.title ?? "otra tarea"}»`).join(", ")}`
              : ""}
            {topic.children.total > 0 ? ` · ${topic.children.done}/${topic.children.total} subtareas hechas` : ""}
          </p>
        </div>
        <Select value={topic.status} onValueChange={(status) => void patch({ status: status as TopicStatus })}>
          <SelectTrigger size="sm" aria-label="Estado de la tarea" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TOPIC_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {TOPIC_LABEL[status]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={topic.assigneeBotId ?? NONE} onValueChange={(value) => void patch({ assigneeBotId: value === NONE ? null : value })}>
          <SelectTrigger size="sm" aria-label="Responsable" className="w-40">
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
        {busy ? (
          <Button size="sm" variant="outline" onClick={() => void round("stop")}>
            <Square className="size-3" /> Parar
          </Button>
        ) : null}
        <Button size="icon" variant="ghost" className="size-8" aria-label="Borrar hilo" onClick={() => void remove()}>
          <Trash2 className="size-4" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto grid max-w-3xl gap-5">
          {error ? (
            <p role="alert" className="text-danger text-sm">
              {error}
            </p>
          ) : !detail ? (
            <Skeleton className="h-24 w-full rounded-xl" />
          ) : detail.messages.length === 0 && !activeTurn ? (
            <p className="text-muted-fg text-center text-sm">Todavía no hay mensajes en este hilo.</p>
          ) : null}
          {detail?.messages.map((message) =>
            message.role === "system" ? (
              <Notice
                key={message.id}
                message={message}
                member={memberOf(message.notice?.botId)}
                canContinue={held.length > 0}
                onContinue={() => void round("continue")}
                onStart={(botId) => void startBot(botId)}
              />
            ) : message.role === "user" ? (
              <article key={message.id} className="flex justify-end">
                <div className="bg-surface-2 max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] break-words whitespace-pre-wrap">{message.content}</div>
              </article>
            ) : (
              <BotMessage key={message.id} member={memberOf(message.botId)} time={TIME.format(new Date(message.createdAt))} onOpenBot={onOpenBot}>
                <ReasoningNote text={message.reasoning} />
                <ToolSteps calls={(message.tools ?? []).filter((tool) => tool.name)} />
                <Markdown className="text-[15px]">{message.content}</Markdown>
              </BotMessage>
            ),
          )}
          {showLive ? <LiveTurn key={activeTurn.id} turn={activeTurn} member={memberOf(activeTurn.botId)} onOpenBot={onOpenBot} /> : null}
          {queued.length > 0 ? (
            <p className="text-muted-fg text-[13px]">En cola: {queued.map((turn) => `@${memberOf(turn.botId)?.slug ?? "bot"}`).join(", ")}</p>
          ) : null}
          <div ref={bottom} />
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <RoomComposer
          members={members}
          hint={
            assignee
              ? `Sin @mención responde ${assignee.name}, responsable de este hilo.`
              : "Sin @mención nadie responde: el mensaje queda como nota."
          }
          onSend={(text) => act(send(`${base}/messages`, "POST", { text }), "No se pudo enviar el mensaje")}
        />
      </div>
    </section>
  );
}
