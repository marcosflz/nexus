"use client";

import { createContext, useContext } from "react";
import type { ProjectSummary, ThreadSummary } from "@/components/chat/types";
import type { Permission, UserRole } from "@/lib/access";

export type SettingsSection = "account" | "preferences" | "models" | "subscriptions" | "connectors" | "usage" | "search" | "assistant" | "claudeCode";

export interface ShellUser {
  id: string;
  email: string;
  role: UserRole;
  permissions: Record<Permission, boolean>;
}

export interface ShellContextValue {
  user: ShellUser;
  threads: ThreadSummary[];
  projects: ProjectSummary[];
  /** Hilo abierto en la portada (`/`). null = portada vacía («¿Qué quieres saber?»). */
  currentThreadId: string | null;
  /** Proyecto en el que se creará el próximo chat nuevo. */
  activeProjectId: string | null;
  /** Se incrementa en cada «Nuevo chat» para que el chat limpie adjuntos y estado. */
  newChatSignal: number;
  unread: number;
  /** Hilos con una respuesta en curso (se muestra un spinner en la lista). */
  runningThreadIds: string[];
  /** Hilos que terminaron de responder mientras no se estaban mirando. */
  unreadThreadIds: string[];
  setThreadRunning(id: string, running: boolean): void;

  selectThread(id: string | null): void;
  newChat(projectId?: string | null): void;
  refreshThreads(): Promise<void>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  moveThread(id: string, projectId: string | null): Promise<void>;
  requestRename(thread: ThreadSummary): void;
  requestDelete(thread: ThreadSummary): void;

  requestCreateProject(moveThreadId?: string): void;
  requestRenameProject(project: ProjectSummary): void;
  requestDeleteProject(project: ProjectSummary): void;

  openSettings(section?: SettingsSection, opts?: { notice?: string }): void;
  openSearch(): void;
}

export const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell debe usarse dentro de <AppShell>");
  return value;
}
