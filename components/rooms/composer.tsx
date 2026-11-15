"use client";

import { useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BotAvatar } from "./bot-avatar";
import type { Member } from "./types";

/** Fragmento `@parcial` justo antes del cursor, o null si no se está escribiendo una mención. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[^\p{L}\p{N}_@/.])@([a-z0-9-]*)$/iu.exec(before);
  return match ? { start: before.length - match[2].length - 1, query: match[2].toLowerCase() } : null;
}

export function RoomComposer({
  members,
  hint,
  disabled,
  onSend,
}: {
  members: Member[];
  hint: string;
  disabled?: boolean;
  onSend: (text: string) => Promise<boolean>;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [sending, setSending] = useState(false);

  const query = dismissed ? null : mentionQuery(text, caret);
  const options = query ? members.filter((member) => member.slug.startsWith(query.query) || member.name.toLowerCase().startsWith(query.query)).slice(0, 6) : [];
  const open = options.length > 0;
  const index = Math.min(active, options.length - 1);

  function pick(member: Member) {
    if (!query) return;
    const next = `${text.slice(0, query.start)}@${member.slug} ${text.slice(caret)}`;
    const position = query.start + member.slug.length + 2;
    setText(next);
    setCaret(position);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(position, position);
    });
  }

  async function submit() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    const ok = await onSend(value);
    setSending(false);
    if (ok) setText("");
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pick(options[index]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <div className="relative">
      {open ? (
        <ul role="listbox" aria-label="Bots de la sala" className="border-border bg-bg absolute bottom-full left-0 z-10 mb-2 w-72 overflow-hidden rounded-xl border shadow-lg">
          {options.map((member, position) => (
            <li key={member.id} role="option" aria-selected={position === index}>
              <button
                type="button"
                className={cn("flex w-full items-center gap-2 px-3 py-2 text-left text-sm", position === index && "bg-surface-2")}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(member);
                }}
              >
                <BotAvatar member={member} size="sm" />
                <span className="truncate">{member.name}</span>
                <span className="text-muted-fg ml-auto text-[12px]">@{member.slug}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="border-border bg-surface-2/40 focus-within:border-fg/30 flex items-end gap-2 rounded-2xl border px-3 py-2">
        <textarea
          ref={ref}
          rows={1}
          value={text}
          disabled={disabled}
          aria-label="Mensaje para la sala"
          placeholder="Escribe a la sala. Usa @ para dirigirte a un bot"
          className="max-h-40 min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] outline-none"
          onChange={(event) => {
            setText(event.target.value);
            setCaret(event.target.selectionStart);
            setDismissed(false);
            setActive(0);
          }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
        />
        <Button type="button" size="icon" className="size-8 shrink-0 rounded-full" aria-label="Enviar" disabled={disabled || sending || !text.trim()} onClick={() => void submit()}>
          <ArrowUp className="size-4" />
        </Button>
      </div>
      <p className="text-muted-fg mt-1.5 px-1 text-[12px]">{hint}</p>
    </div>
  );
}
