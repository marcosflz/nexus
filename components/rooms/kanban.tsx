"use client";

import { useState } from "react";
import { Loader2, Lock, MessageSquare } from "lucide-react";
import type { TopicStatus } from "@/lib/db/schema";
import { TOPIC_LABEL, TOPIC_STATUSES } from "@/lib/rooms/spec";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import type { Member, TopicCard } from "./types";

/**
 * Tablero de la sala: cada tarjeta es un hilo. Se mueve arrastrando o con el
 * selector «Mover a», que es lo que hace accesible el tablero sin ratón.
 */
export function Kanban({
  topics,
  members,
  onOpen,
  onMove,
}: {
  topics: TopicCard[];
  members: Member[];
  onOpen: (topicId: string) => void;
  onMove: (topicId: string, status: TopicStatus) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TopicStatus | null>(null);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-4" aria-label="Tablero de la sala">
      {TOPIC_STATUSES.map((status) => {
        const cards = topics.filter((topic) => topic.status === status);
        return (
          <section
            key={status}
            aria-label={TOPIC_LABEL[status]}
            data-status={status}
            className={cn("bg-surface-2/50 flex w-64 shrink-0 flex-col rounded-xl p-2", over === status && "ring-brand ring-2")}
            onDragOver={(event) => {
              event.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((current) => (current === status ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/plain") || dragging;
              setOver(null);
              setDragging(null);
              if (id && topics.find((topic) => topic.id === id)?.status !== status) onMove(id, status);
            }}
          >
            <h3 className="text-muted-fg flex items-center justify-between px-2 py-1.5 text-[12px] font-medium tracking-wide uppercase">
              {TOPIC_LABEL[status]} <span>{cards.length}</span>
            </h3>
            <ul className="grid min-h-10 content-start gap-2 overflow-y-auto">
              {cards.map((topic) => {
                const assignee = members.find((member) => member.id === topic.assigneeBotId);
                const blocked = topic.blockedBy.filter((blocker) => !blocker.resolved).length;
                return (
                  <li
                    key={topic.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", topic.id);
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(topic.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn("border-border bg-bg grid gap-2 rounded-lg border p-2.5 shadow-xs", dragging === topic.id && "opacity-50")}
                  >
                    <button type="button" className="text-left text-[14px] leading-snug hover:underline" onClick={() => onOpen(topic.id)}>
                      {topic.title}
                    </button>
                    <div className="text-muted-fg flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px]">
                      {assignee ? (
                        <span className="inline-flex items-center gap-1">
                          <BotAvatar member={assignee} size="sm" busy={topic.activeBotId === assignee.id} /> {assignee.name}
                        </span>
                      ) : (
                        <span>Sin responsable</span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="size-3" /> {topic.messages}
                      </span>
                      {topic.children.total > 0 ? <span>{topic.children.done}/{topic.children.total} subtareas</span> : null}
                      {blocked > 0 ? (
                        <span className="text-warning inline-flex items-center gap-1">
                          <Lock className="size-3" /> {blocked}
                        </span>
                      ) : null}
                      {topic.activeBotId ? <Loader2 className="text-brand size-3 animate-spin" aria-label="Un bot está trabajando" /> : null}
                    </div>
                    <select
                      aria-label={`Mover «${topic.title}» a`}
                      value={topic.status}
                      className="border-border text-muted-fg rounded-md border bg-transparent px-1.5 py-1 text-[12px]"
                      onChange={(event) => onMove(topic.id, event.target.value as TopicStatus)}
                    >
                      {TOPIC_STATUSES.map((option) => (
                        <option key={option} value={option}>
                          {TOPIC_LABEL[option]}
                        </option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
