export interface Groupable {
  updatedAt: string;
}

export interface ThreadGroup<T extends Groupable> {
  label: string;
  threads: T[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Agrupa hilos (ya ordenados de más a menos reciente) en Hoy, Ayer, 7 días, 30 días y Anteriores. */
export function groupThreadsByDate<T extends Groupable>(
  threads: T[],
  now: Date = new Date(),
): ThreadGroup<T>[] {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: ThreadGroup<T>[] = [
    { label: "Hoy", threads: [] },
    { label: "Ayer", threads: [] },
    { label: "Últimos 7 días", threads: [] },
    { label: "Últimos 30 días", threads: [] },
    { label: "Anteriores", threads: [] },
  ];

  for (const thread of threads) {
    const time = new Date(thread.updatedAt).getTime();
    const index =
      time >= startOfToday
        ? 0
        : time >= startOfToday - DAY_MS
          ? 1
          : time >= startOfToday - 7 * DAY_MS
            ? 2
            : time >= startOfToday - 30 * DAY_MS
              ? 3
              : 4;
    buckets[index].threads.push(thread);
  }
  return buckets.filter((bucket) => bucket.threads.length > 0);
}
