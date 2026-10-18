"use client";

import Link from "next/link";
import type { ThreadSummary } from "./types";

export function Sidebar({
  threads,
  currentThreadId,
  userEmail,
  onSelect,
  onNew,
  onDelete,
}: {
  threads: ThreadSummary[];
  currentThreadId: string | null;
  userEmail: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <aside className="hidden w-64 flex-col border-r border-neutral-800 bg-neutral-950 md:flex">
      <div className="flex items-center justify-between gap-2 p-3">
        <span className="font-semibold tracking-tight">Plexo</span>
        <button
          onClick={onNew}
          className="rounded-lg border border-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:border-neutral-600"
        >
          + Nuevo
        </button>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-2">
        {threads.map((thread) => (
          <div
            key={thread.id}
            className={`group flex items-center gap-1 rounded-lg px-1 ${
              thread.id === currentThreadId ? "bg-neutral-800/70" : "hover:bg-neutral-900"
            }`}
          >
            <button
              onClick={() => onSelect(thread.id)}
              className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm text-neutral-200"
              title={thread.title}
            >
              {thread.title}
            </button>
            <button
              onClick={() => onDelete(thread.id)}
              className="hidden px-1.5 py-1 text-xs text-neutral-500 hover:text-red-400 group-hover:block"
              aria-label="Eliminar conversación"
            >
              ×
            </button>
          </div>
        ))}
        {threads.length === 0 ? (
          <p className="p-2 text-xs text-neutral-500">Sin conversaciones todavía</p>
        ) : null}
      </nav>

      <div className="border-t border-neutral-800 p-3 text-xs">
        <p className="truncate text-neutral-400">{userEmail}</p>
        <div className="mt-2 flex items-center gap-3">
          <Link href="/settings" className="text-sky-400 hover:underline">
            Ajustes
          </Link>
          <button onClick={logout} className="text-neutral-400 hover:underline">
            Salir
          </button>
        </div>
      </div>
    </aside>
  );
}
