"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BarChart3, Bot, Inbox, MessageSquare, Plus, Settings } from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import type { ThreadSummary } from "@/components/chat/types";
import { groupThreadsByDate } from "@/lib/threads/group";
import { useShell } from "./shell-context";

export function SearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const shell = useShell();
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ThreadSummary[] | null>(null);
  const [loading, setLoading] = useState(false);

  const trimmed = query.trim();

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- se limpia al cerrar
      setQuery("");
      setFound(null);
      return;
    }
    if (!trimmed) {
      setFound(null);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      fetch(`/api/threads?q=${encodeURIComponent(trimmed)}`)
        .then((res) => (res.ok ? res.json() : { threads: [] }))
        .then((data: { threads: ThreadSummary[] }) => alive && setFound(data.threads))
        .catch(() => alive && setFound([]))
        .finally(() => alive && setLoading(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, trimmed]);

  const results = trimmed ? (found ?? []) : shell.threads.slice(0, 20);
  const groups = useMemo(() => groupThreadsByDate(results), [results]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    fn();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Buscar"
      description="Busca en tus chats"
      className="top-[18%] sm:max-w-2xl"
    >
      <Command shouldFilter={false} className="rounded-2xl!">
        <CommandInput placeholder="Buscar en tus chats…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[60vh]">
          <CommandEmpty>{loading ? "Buscando…" : "Sin resultados."}</CommandEmpty>
          {!trimmed ? (
            <CommandGroup heading="Acciones">
              <CommandItem onSelect={() => run(() => shell.newChat())}>
                <Plus /> Nuevo chat <CommandShortcut>Ctrl ⇧ O</CommandShortcut>
              </CommandItem>
              {shell.user.permissions.skills ? (
                <CommandItem onSelect={() => run(() => router.push("/skills"))}>
                  <Bot /> Skills
                </CommandItem>
              ) : null}
              <CommandItem onSelect={() => run(() => router.push("/inbox"))}>
                <Inbox /> Bandeja
              </CommandItem>
              <CommandItem onSelect={() => run(() => router.push("/usage"))}>
                <BarChart3 /> Uso
              </CommandItem>
              <CommandItem onSelect={() => run(() => shell.openSettings())}>
                <Settings /> Ajustes <CommandShortcut>Ctrl ,</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          ) : null}
          {groups.map((group) => (
            <CommandGroup key={group.label} heading={group.label}>
              {group.threads.map((thread) => (
                <CommandItem key={thread.id} value={thread.id} onSelect={() => run(() => shell.selectThread(thread.id))}>
                  <MessageSquare /> <span className="truncate">{thread.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
