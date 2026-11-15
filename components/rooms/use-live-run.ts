"use client";

import { useEffect, useState } from "react";
import type { UiMessage } from "@/components/chat/types";
import { followRun } from "@/lib/agui/client";
import { initialAgUiState, reduceAgUi } from "@/lib/agui/reducer";

/** Sigue un run en marcha y devuelve su mensaje según llega. Null si no hay run. */
export function useLiveRun(runId: string | null): UiMessage | null {
  const [live, setLive] = useState<{ runId: string; message: UiMessage } | null>(null);

  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let state = initialAgUiState(`live-${runId}`);
    void followRun({
      runId,
      after: 0,
      fetchEvents: (id, after, signal) => fetch(`/api/runs/${id}/events?after=${after}`, { signal }),
      onEvent: (event) => {
        state = reduceAgUi(state, event);
        setLive({ runId, message: state.message });
      },
      signal: controller.signal,
    }).catch(() => {});
    return () => controller.abort();
  }, [runId]);

  return live && live.runId === runId ? live.message : null;
}
