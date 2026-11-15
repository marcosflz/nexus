export interface SectionThread {
  id: string;
  updatedAt: string;
  pinnedAt: string | null;
  projectId: string | null;
}

export interface ThreadSections<T extends SectionThread> {
  /** Fijados, del más reciente al más antiguo según `pinnedAt`. */
  pinned: T[];
  /** Chats no fijados de cada proyecto, en el orden recibido (por `updatedAt` desc). */
  byProject: Record<string, T[]>;
  /** Chats no fijados y sin proyecto. */
  recent: T[];
}

/** Reparte los hilos (ya ordenados por `updatedAt` desc) en las secciones de la barra lateral. */
export function splitThreads<T extends SectionThread>(threads: T[]): ThreadSections<T> {
  const pinned: T[] = [];
  const byProject: Record<string, T[]> = {};
  const recent: T[] = [];
  for (const thread of threads) {
    if (thread.pinnedAt) pinned.push(thread);
    else if (thread.projectId) (byProject[thread.projectId] ??= []).push(thread);
    else recent.push(thread);
  }
  pinned.sort((a, b) => (a.pinnedAt! < b.pinnedAt! ? 1 : a.pinnedAt! > b.pinnedAt! ? -1 : 0));
  return { pinned, byProject, recent };
}
