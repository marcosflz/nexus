"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import type { ProjectSummary, ThreadSummary } from "@/components/chat/types";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { AppSidebar } from "./app-sidebar";
import { ShellDialogs, type ProjectDialogState } from "./dialogs";
import { SearchDialog } from "./search-dialog";
import { ShellContext, type SettingsSection, type ShellContextValue, type ShellUser } from "./shell-context";

const RUNNING_POLL_MS = 3000;
const UNREAD_KEY = "nexus:unread-threads";

const SECTIONS: SettingsSection[] = ["account", "preferences", "models", "subscriptions", "connectors", "usage", "search", "assistant", "claudeCode"];

function sectionFromHash(hash: string): SettingsSection | null {
  if (!hash.startsWith("#settings")) return null;
  const name = hash.split("/")[1] as SettingsSection | undefined;
  return name && SECTIONS.includes(name) ? name : "account";
}

export function AppShell({
  user,
  initialThreads,
  initialProjects,
  sidebarOpen,
  children,
}: {
  user: ShellUser;
  initialThreads: ThreadSummary[];
  initialProjects: ProjectSummary[];
  sidebarOpen: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [threads, setThreads] = useState(initialThreads);
  const [projects, setProjects] = useState(initialProjects);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [newChatSignal, setNewChatSignal] = useState(0);
  const [unread, setUnread] = useState(0);
  /** Hilos que este navegador está siguiendo en directo (antes de que la lista del servidor lo sepa). */
  const [localRunning, setLocalRunning] = useState<string[]>([]);
  const [unreadThreadIds, setUnreadThreadIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settings, setSettings] = useState<{ open: boolean; section: SettingsSection; notice?: string }>({
    open: false,
    section: "account",
  });
  const [renaming, setRenaming] = useState<ThreadSummary | null>(null);
  const [deleting, setDeleting] = useState<ThreadSummary | null>(null);
  const [projectDialog, setProjectDialog] = useState<ProjectDialogState>(null);
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null);

  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const currentRef = useRef(currentThreadId);
  currentRef.current = currentThreadId;
  const pathRef = useRef(pathname);
  pathRef.current = pathname;

  const refreshThreads = useCallback(async () => {
    try {
      const res = await fetch("/api/threads");
      if (!res.ok) return;
      const data = (await res.json()) as { threads: ThreadSummary[] };
      setThreads(data.threads);
    } catch {
      // Sin red: se conserva la lista actual.
    }
  }, []);

  const runningThreadIds = useMemo(() => {
    const ids = new Set(localRunning);
    for (const thread of threads) if (thread.running) ids.add(thread.id);
    return [...ids];
  }, [localRunning, threads]);

  const setThreadRunning = useCallback(
    (id: string, running: boolean) => {
      if (running) {
        setLocalRunning((prev) => (prev.includes(id) ? prev : [...prev, id]));
        return;
      }
      // Se suelta cuando la lista ya refleja lo que hace el servidor: si el run sigue
      // (la persona se fue a otro chat), el indicador no parpadea.
      void refreshThreads().finally(() => setLocalRunning((prev) => prev.filter((x) => x !== id)));
    },
    [refreshThreads],
  );

  // Mientras algo se esté generando, la lista se refresca para saber cuándo termina.
  const anyRunning = runningThreadIds.length > 0;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = window.setInterval(() => void refreshThreads(), RUNNING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [anyRunning, refreshThreads]);

  // Un hilo que termina mientras no se está mirando queda marcado como «respondido».
  const previousRunning = useRef<Set<string>>(new Set(initialThreads.filter((t) => t.running).map((t) => t.id)));
  useEffect(() => {
    const now = new Set(runningThreadIds);
    const finished = [...previousRunning.current].filter(
      (id) => !now.has(id) && !(pathRef.current === "/" && currentRef.current === id),
    );
    previousRunning.current = now;
    setUnreadThreadIds((prev) => {
      const next = prev.filter((id) => !now.has(id));
      for (const id of finished) if (!next.includes(id)) next.push(id);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [runningThreadIds]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(UNREAD_KEY) ?? "[]") as unknown;
      if (Array.isArray(stored)) {
        const ids = stored.filter((id): id is string => typeof id === "string");
        setUnreadThreadIds((prev) => [...new Set([...ids, ...prev])]);
      }
    } catch {
      // Sin almacenamiento local, los avisos duran lo que la pestaña.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(UNREAD_KEY, JSON.stringify(unreadThreadIds));
    } catch {
      // Ídem.
    }
  }, [unreadThreadIds]);

  // Abrir el hilo es haberlo leído.
  useEffect(() => {
    if (pathname !== "/" || !currentThreadId) return;
    setUnreadThreadIds((prev) => (prev.includes(currentThreadId) ? prev.filter((id) => id !== currentThreadId) : prev));
  }, [pathname, currentThreadId]);

  const navigateHome = useCallback(
    (href: string) => {
      if (pathRef.current !== "/") router.push(href);
      else window.history.replaceState(null, "", href);
    },
    [router],
  );

  const selectThread = useCallback(
    (id: string | null) => {
      setCurrentThreadId(id);
      const thread = id ? threadsRef.current.find((t) => t.id === id) : null;
      setActiveProjectId(thread?.projectId ?? null);
      navigateHome(id ? `/?thread=${id}` : "/");
    },
    [navigateHome],
  );

  const newChat = useCallback(
    (projectId: string | null = null) => {
      setActiveProjectId(projectId);
      setCurrentThreadId(null);
      setNewChatSignal((n) => n + 1);
      navigateHome("/");
    },
    [navigateHome],
  );

  const patchThread = useCallback(
    async (id: string, body: Record<string, unknown>, local: Partial<ThreadSummary>, ok: string) => {
      setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, ...local } : t)));
      const res = await fetch(`/api/threads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res || !res.ok) {
        toast.error("No se pudo actualizar el chat");
        void refreshThreads();
        return;
      }
      if (ok) toast.success(ok);
    },
    [refreshThreads],
  );

  const setPinned = useCallback(
    (id: string, pinned: boolean) =>
      patchThread(
        id,
        { pinned },
        { pinnedAt: pinned ? new Date().toISOString() : null },
        pinned ? "Chat fijado" : "Chat desfijado",
      ),
    [patchThread],
  );

  const moveThread = useCallback(
    (id: string, projectId: string | null) =>
      patchThread(
        id,
        { projectId },
        { projectId },
        projectId ? "Chat movido al proyecto" : "Chat quitado del proyecto",
      ),
    [patchThread],
  );

  const renameThread = useCallback(
    async (id: string, title: string) => {
      await patchThread(id, { title }, { title }, "");
    },
    [patchThread],
  );

  const deleteThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/threads/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      toast.error("No se pudo eliminar el chat");
      return;
    }
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (currentRef.current === id) {
      setCurrentThreadId(null);
      setNewChatSignal((n) => n + 1);
      if (pathRef.current === "/") window.history.replaceState(null, "", "/");
    }
  }, []);

  const createProject = useCallback(
    async (name: string, moveThreadId?: string) => {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => ({}))) as { project?: ProjectSummary; error?: string } | undefined;
      if (!res || !res.ok || !data?.project) {
        toast.error(data?.error ?? "No se pudo crear el proyecto");
        return;
      }
      const project = data.project;
      setProjects((prev) => [project, ...prev]);
      if (moveThreadId) await moveThread(moveThreadId, project.id);
    },
    [moveThread],
  );

  const renameProject = useCallback(async (id: string, name: string) => {
    setProjects((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res || !res.ok) {
      toast.error("No se pudo renombrar el proyecto");
      const list = await fetch("/api/projects").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (list) setProjects((list as { projects: ProjectSummary[] }).projects);
    }
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) {
      toast.error("No se pudo eliminar el proyecto");
      return;
    }
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setThreads((prev) => prev.map((t) => (t.projectId === id ? { ...t, projectId: null } : t)));
    setActiveProjectId((prev) => (prev === id ? null : prev));
    toast.success("Proyecto eliminado");
  }, []);

  const openSettings = useCallback((section: SettingsSection = "account", opts?: { notice?: string }) => {
    setSettings({ open: true, section, notice: opts?.notice });
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#settings/${section}`);
  }, []);

  const closeSettings = useCallback(() => {
    setSettings((s) => ({ ...s, open: false, notice: undefined }));
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  const openSearch = useCallback(() => setSearchOpen(true), []);

  // Contador de no leídas.
  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetch("/api/notifications/count")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { unread: number } | null) => alive && data && setUnread(data.unread))
        .catch(() => {});
    void poll();
    const timer = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  // Hash de ajustes (#settings/<sección>).
  useEffect(() => {
    const sync = () => {
      const section = sectionFromHash(window.location.hash);
      if (section) setSettings((s) => ({ ...s, open: true, section }));
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // Atajos de teclado.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setSearchOpen(true);
      } else if (key === ",") {
        event.preventDefault();
        openSettings();
      } else if (key === "o" && event.shiftKey) {
        event.preventDefault();
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSettings, newChat]);

  const value = useMemo<ShellContextValue>(
    () => ({
      user,
      threads,
      projects,
      currentThreadId,
      activeProjectId,
      newChatSignal,
      unread,
      runningThreadIds,
      unreadThreadIds,
      setThreadRunning,
      selectThread,
      newChat,
      refreshThreads,
      setPinned,
      moveThread,
      requestRename: setRenaming,
      requestDelete: setDeleting,
      requestCreateProject: (moveThreadId) => setProjectDialog({ mode: "create", moveThreadId }),
      requestRenameProject: (project) => setProjectDialog({ mode: "rename", project }),
      requestDeleteProject: setDeletingProject,
      openSettings,
      openSearch,
    }),
    [
      user,
      threads,
      projects,
      currentThreadId,
      activeProjectId,
      newChatSignal,
      unread,
      runningThreadIds,
      unreadThreadIds,
      setThreadRunning,
      selectThread,
      newChat,
      refreshThreads,
      setPinned,
      moveThread,
      openSettings,
      openSearch,
    ],
  );

  return (
    <ShellContext.Provider value={value}>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <AppSidebar />
        <SidebarInset className="min-h-svh min-w-0 bg-bg">{children}</SidebarInset>
      </SidebarProvider>
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <SettingsDialog
        open={settings.open}
        section={settings.section}
        notice={settings.notice}
        onSectionChange={(section) => openSettings(section, { notice: settings.notice })}
        onClose={closeSettings}
      />
      <ShellDialogs
        renaming={renaming}
        onCloseRename={() => setRenaming(null)}
        onRename={renameThread}
        deleting={deleting}
        onCloseDelete={() => setDeleting(null)}
        onDelete={deleteThread}
        projectDialog={projectDialog}
        onCloseProject={() => setProjectDialog(null)}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        deletingProject={deletingProject}
        onCloseDeleteProject={() => setDeletingProject(null)}
        onDeleteProject={deleteProject}
      />
    </ShellContext.Provider>
  );
}
