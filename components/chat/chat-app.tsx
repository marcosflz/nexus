"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AddToolResultOptions,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { EventType } from "@ag-ui/core";
import { toast } from "sonner";
import { followRun } from "@/lib/agui/client";
import { initialAgUiState, reduceAgUi, type AgUiState } from "@/lib/agui/reducer";
import { OPENUI_TOOL_NAME } from "@/lib/openui/blocks";
import type { ResumeEntryInput } from "@/lib/runs/launch";
import { randomId } from "@/lib/uuid";
import { useShell } from "@/components/shell/shell-context";
import { PREFS_EVENT, readPrefs, type Prefs } from "@/lib/prefs";
import { ChatActionsProvider, type ChatActions, type MessageCustom } from "./chat-context";
import { ChatHeader } from "./chat-header";
import { ChatThread, type ModelChoiceOption, type ModelGroupOption } from "./thread";
import { MODELS_CHANGED_EVENT, readStoredModel, storeModel } from "@/lib/models/selection";
import type {
  PendingAttachment,
  UiAttachment,
  UiInterrupt,
  UiMessage,
  UiPart,
  UiSource,
  UiToolCall,
  UiUsage,
} from "./types";

interface ServerMessage {
  id: string;
  role: string;
  content: string;
  sources: UiSource[] | null;
  tools: UiToolCall[] | null;
  attachments: UiAttachment[] | null;
  usage: UiUsage | null;
  parts: UiPart[] | null;
  reasoning?: string | null;
  followups: string[] | null;
  runId: string | null;
  rating: number | null;
  createdAt: string;
}

interface ServerActiveRun {
  id: string;
  status: string;
  lastSeq: number;
}

function fromServerMessage(row: ServerMessage): UiMessage {
  return {
    id: row.id,
    serverId: row.id,
    role: row.role === "user" ? "user" : "assistant",
    content: row.content,
    tools: (row.tools ?? []).map((tool) => ({
      ...tool,
      status: tool.status === "running" ? "complete" : tool.status,
    })),
    sources: row.sources ?? [],
    attachments: row.attachments ?? [],
    usage: row.usage ?? null,
    parts: row.parts ?? undefined,
    reasoning: row.reasoning ?? undefined,
    followups: row.followups ?? undefined,
    runId: row.runId ?? undefined,
    rating: row.rating === 1 || row.rating === -1 ? row.rating : null,
    status: "complete",
    createdAt: row.createdAt,
  };
}

const placeholder = (id: string): UiMessage => ({
  id,
  role: "assistant",
  content: "",
  tools: [],
  sources: [],
  attachments: [],
  status: "running",
  createdAt: new Date().toISOString(),
});

/** El resultado de una herramienta llega como texto; si es JSON, se entrega como objeto. */
function parseToolResult(result: string | undefined): unknown {
  if (!result) return "";
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

interface TurnRequest {
  text: string;
  attachments: PendingAttachment[];
  /** Mensaje de usuario (id del servidor) que este turno sustituye. */
  replaceServerId?: string;
}

interface AgentSummary {
  id: string;
  name: string;
  avatar: string;
  slug: string;
}

export function ChatApp({
  initialAgentId = null,
  initialThreadId = null,
}: {
  /** Agente preseleccionado (`/?agent=`). Empieza un chat nuevo con él. */
  initialAgentId?: string | null;
  /** Hilo a abrir (`/?thread=`). */
  initialThreadId?: string | null;
}) {
  const shell = useShell();
  const currentThreadId = shell.currentThreadId;
  const [agentId, setAgentId] = useState<string | null>(initialAgentId);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agentStarters, setAgentStarters] = useState<string[] | undefined>(undefined);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [loadingThread, setLoadingThread] = useState(false);
  const [modelGroups, setModelGroups] = useState<ModelGroupOption[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelChoiceOption | null>(null);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [agentModel, setAgentModel] = useState<{ provider?: string; model?: string } | null>(null);
  const [focus, setFocus] = useState("web");
  const [mode, setMode] = useState<"search" | "research">("search");
  const [uiMode, setUiMode] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const messagesRef = useRef<UiMessage[]>([]);
  messagesRef.current = messages;
  const threadRef = useRef<string | null>(currentThreadId);
  threadRef.current = currentThreadId;

  /**
   * Control del *seguimiento* SSE en curso. El run vive en el servidor: abortar
   * esto solo desengancha la pestaña (cambio de hilo, recarga); para parar el
   * run hay que llamar a `onCancel`.
   */
  const followRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  /** Estado del reducer de cada mensaje, para continuar tras una pausa. */
  const statesRef = useRef(new Map<string, AgUiState>());
  /** Hilo recién creado por nosotros: sus mensajes ya están en pantalla, no se recargan. */
  const skipLoadRef = useRef<string | null>(null);

  // --- agentes, notificaciones ---------------------------------------------

  useEffect(() => {
    fetch("/api/bots")
      .then((res) => (res.ok ? res.json() : { bots: [] }))
      .then((data: { bots: AgentSummary[] }) =>
        setAgents(data.bots),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    let alive = true;
    setSelectedSkills([]);
    void Promise.all([
      fetch("/api/skills").then((response) => response.ok ? response.json() : { skills: [] }),
      agentId ? fetch(`/api/bots/${agentId}`).then((response) => response.ok ? response.json() : null) : Promise.resolve(null),
    ]).then(([library, profile]) => {
      if (alive) setAvailableSkills(library.skills.filter((skill: { id: string; enabledInChat: boolean }) => agentId ? profile?.bot?.skillIds?.includes(skill.id) : skill.enabledInChat));
    }).catch(() => { if (alive) setAvailableSkills([]); });
    return () => { alive = false; };
  }, [agentId]);

  // Las preguntas de arranque del agente elegido, y su modelo si lo fija.
  useEffect(() => {
    setAgentStarters(undefined);
    setAgentModel(null);
    if (!agentId) return;
    let alive = true;
    fetch(`/api/bots/${agentId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { spec?: { starters?: string[]; model?: { provider?: string; model?: string } } } | null) => {
        if (!alive) return;
        if (data?.spec?.starters?.length) setAgentStarters(data.spec.starters);
        const fixed = data?.spec?.model;
        if (fixed && (fixed.provider || fixed.model)) setAgentModel(fixed);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [agentId]);

  /** `/?agent=` abre un chat nuevo con ese agente: la señal de «nuevo chat» no debe quitarlo. */
  const keepAgentRef = useRef(false);

  // Apertura inicial desde la URL (`/?thread=` o `/?agent=`).
  useEffect(() => {
    if (initialThreadId) shell.selectThread(initialThreadId);
    else if (initialAgentId) {
      keepAgentRef.current = true;
      shell.newChat();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  }, []);

  // Preferencias de búsqueda (Ajustes → Preferencias).
  useEffect(() => {
    const apply = (p: Prefs) => {
      setFocus(p.focus);
      setMode(p.mode);
      setUiMode(p.ui);
    };
    apply(readPrefs());
    const onPrefs = (event: Event) => apply((event as CustomEvent<Prefs>).detail);
    window.addEventListener(PREFS_EVENT, onPrefs);
    return () => window.removeEventListener(PREFS_EVENT, onPrefs);
  }, []);

  // Modelos activos de todos los proveedores, para el selector del compositor. Se recargan
  // cuando cambian en Ajustes o al volver a la pestaña.
  useEffect(() => {
    const load = () =>
      fetch("/api/models")
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { groups: ModelGroupOption[]; default: ModelChoiceOption | null } | null) => {
          if (!data) return;
          setModelGroups(data.groups);
          const exists = (choice: ModelChoiceOption | null) =>
            Boolean(choice && data.groups.some((g) => g.provider === choice.provider && g.models.some((m) => m.id === choice.model)));
          setSelectedModel((current) => {
            if (exists(current)) return current;
            const stored = readStoredModel();
            return exists(stored) ? stored : data.default;
          });
        })
        .catch(() => {});
    void load();
    window.addEventListener(MODELS_CHANGED_EVENT, load);
    window.addEventListener("focus", load);
    return () => {
      window.removeEventListener(MODELS_CHANGED_EVENT, load);
      window.removeEventListener("focus", load);
    };
  }, []);

  const changeModel = useCallback((choice: ModelChoiceOption) => {
    setSelectedModel(choice);
    storeModel(choice);
  }, []);

  // «Nuevo chat»: se limpian adjuntos y se vuelve al agente integrado (salvo al montar).
  const firstSignal = useRef(true);
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      return;
    }
    setPendingAttachments([]);
    setUploadError(null);
    if (keepAgentRef.current) keepAgentRef.current = false;
    else setAgentId(null);
  }, [shell.newChatSignal]);

  // --- seguimiento de runs -----------------------------------------------

  const beginFollow = useCallback((): AbortController => {
    followRef.current?.abort();
    const controller = new AbortController();
    followRef.current = controller;
    runIdRef.current = null;
    cancelRequestedRef.current = false;
    setIsRunning(true);
    return controller;
  }, []);

  const endFollow = useCallback((controller: AbortController) => {
    if (followRef.current !== controller) return;
    followRef.current = null;
    runIdRef.current = null;
    setIsRunning(false);
  }, []);

  /** Aplica los eventos AG-UI de un run al mensaje del asistente en pantalla. */
  const consumeRun = useCallback(
    async (opts: {
      assistantId: string;
      controller: AbortController;
      initial?: Response;
      runId?: string;
      /** Estado previo del mensaje al reanudar un run en pausa. */
      seed?: AgUiState;
    }) => {
      const { assistantId, controller } = opts;
      let state = opts.seed ?? initialAgUiState(assistantId);
      let serverId: string | undefined;
      const patch = (fn: (message: UiMessage) => UiMessage) =>
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? fn(m) : m)));

      try {
        const result = await followRun({
          initial: opts.initial,
          runId: opts.runId,
          fetchEvents: (runId, after, signal) =>
            fetch(`/api/runs/${runId}/events?after=${after}`, { signal }),
          onEvent: (event) => {
            if (event.type === EventType.RUN_STARTED) {
              runIdRef.current = (event as { runId: string }).runId;
            }
            if (event.type === EventType.CUSTOM && (event as { name?: string }).name === "nexus.message") {
              serverId = (event as unknown as { value: { messageId: string } }).value.messageId;
            }
            state = reduceAgUi(state, event);
            statesRef.current.set(assistantId, state);
            patch((m) => ({
              ...state.message,
              id: assistantId,
              serverId: serverId ?? m.serverId,
              rating: m.rating,
            }));
          },
          signal: controller.signal,
        });
        if (!result.terminal && cancelRequestedRef.current) {
          patch((m) => ({ ...m, status: "error", error: "Generación cancelada" }));
        }
      } catch (error) {
        patch((m) => ({
          ...m,
          status: "error",
          error: error instanceof Error ? error.message : "Error desconocido",
        }));
      } finally {
        endFollow(controller);
      }
    },
    [endFollow],
  );

  // --- carga de hilos ------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    // Hilo recién creado por nosotros: el seguimiento en curso es suyo. Hay que
    // comprobarlo ANTES de soltar nada, o se aborta la petición que acaba de salir.
    if (currentThreadId && skipLoadRef.current === currentThreadId) {
      skipLoadRef.current = null;
      return;
    }
    // Cambiar a otro hilo desengancha el seguimiento anterior; el run sigue en el servidor.
    followRef.current?.abort();

    if (!currentThreadId) {
      setMessages([]);
      setLoadingThread(false);
      return;
    }

    setLoadingThread(true);
    fetch(`/api/threads/${currentThreadId}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("no encontrado"))))
      .then(
        (data: {
          thread: { backend: string | null; botId: string | null };
          messages: ServerMessage[];
          activeRun?: ServerActiveRun | null;
        }) => {
          if (cancelled) return;
          setLoadingThread(false);
          setAgentId(data.thread.botId);
          const loaded = data.messages.map(fromServerMessage);
          const active = data.activeRun;
          if (!active) {
            setMessages(loaded);
            return;
          }
          // Recarga a mitad de turno: se reconstruye la respuesta desde el log del run.
          const assistantId = randomId();
          setMessages([...loaded, placeholder(assistantId)]);
          const controller = beginFollow();
          void consumeRun({ assistantId, controller, runId: active.id });
        },
      )
      .catch(() => {
        if (cancelled) return;
        setLoadingThread(false);
        setMessages([]);
        shell.selectThread(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `shell` cambia a cada actualización de la lista
  }, [currentThreadId, beginFollow, consumeRun]);

  // --- subida de archivos --------------------------------------------------

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      const form = new FormData();
      Array.from(files)
        .slice(0, 5)
        .forEach((file) => form.append("files", file));
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        attachments?: PendingAttachment[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudo procesar el archivo");
      setPendingAttachments((prev) => [...prev, ...(data.attachments ?? [])].slice(0, 5));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "No se pudo subir el archivo");
    } finally {
      setUploading(false);
    }
  }, []);

  // --- turnos --------------------------------------------------------------

  const runTurn = useCallback(
    async ({ text, attachments, replaceServerId }: TurnRequest) => {
      const sentFocus = focus === "web" ? undefined : focus;
      // Una preferencia guardada no debe hacer fallar el turno si ya no hay permiso.
      const sentMode = mode === "search" || !shell.user.permissions.research ? undefined : mode;

      // Al editar o regenerar, la conversación se corta en el mensaje sustituido.
      if (replaceServerId) {
        setMessages((prev) => {
          const index = prev.findIndex((m) => m.serverId === replaceServerId);
          return index === -1 ? prev : prev.slice(0, index);
        });
      }

      const userLocalId = randomId();
      const assistantId = randomId();
      setMessages((prev) => [
        ...prev,
        {
          id: userLocalId,
          role: "user",
          content: text,
          tools: [],
          sources: [],
          attachments: attachments.map(({ name, mime, size }) => ({ name, mime, size })),
          status: "complete",
          createdAt: new Date().toISOString(),
        },
        placeholder(assistantId),
      ]);

      const controller = beginFollow();
      const fail = (error: unknown) => {
        const message =
          error instanceof Error && error.name === "AbortError"
            ? cancelRequestedRef.current
              ? "Generación cancelada"
              : null
            : error instanceof Error
              ? error.message
              : "Error desconocido";
        if (message) {
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, status: "error", error: message } : m)),
          );
        }
        endFollow(controller);
      };

      try {
        let threadId = threadRef.current;
        if (!threadId) {
          const res = await fetch("/api/threads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ projectId: shell.activeProjectId ?? undefined }),
          });
          if (!res.ok) throw new Error("No se pudo crear el hilo");
          const data = (await res.json()) as { thread: { id: string } };
          threadId = data.thread.id;
          skipLoadRef.current = threadId;
          shell.selectThread(threadId);
          await shell.refreshThreads();
        }

        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            text,
            focus: sentFocus,
            mode: sentMode,
            ui: (uiMode && shell.user.permissions.generativeUi) || undefined,
            botId: agentId,
            explicitSkills: selectedSkills,
            // Si el agente fija su modelo, manda el suyo (el servidor lo vuelve a comprobar).
            model: agentModel ? undefined : (selectedModel ?? undefined),
            attachments: attachments.length > 0 ? attachments : undefined,
            replace: replaceServerId ? { messageId: replaceServerId } : undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
          if (data.code === "no_credential") {
            // Sin proveedor configurado no hay nada que reintentar: se lleva al
            // usuario a Ajustes y se quita el mensaje en blanco del asistente.
            setMessages((prev) => prev.filter((m) => m.id !== assistantId));
            endFollow(controller);
            shell.openSettings("models", {
              notice: "Antes de chatear necesitas configurar un proveedor y su API key.",
            });
            return;
          }
          throw new Error(data.error ?? `Error del servidor (${res.status})`);
        }

        const userServerId = res.headers.get("X-Nexus-User-Message");
        if (userServerId) {
          setMessages((prev) =>
            prev.map((m) => (m.id === userLocalId ? { ...m, serverId: userServerId } : m)),
          );
        }
        setPendingAttachments([]);
        await consumeRun({ assistantId, controller, initial: res });
        // Solo refresca el título del hilo: un fallo aquí no invalida la respuesta.
        await shell.refreshThreads().catch(() => {});
      } catch (error) {
        fail(error);
      }
    },
    [focus, mode, uiMode, agentId, agentModel, selectedModel, selectedSkills, shell, beginFollow, endFollow, consumeRun],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      const part = message.content[0];
      if (!part || part.type !== "text") return;
      await runTurn({ text: part.text, attachments: pendingAttachments });
    },
    [runTurn, pendingAttachments],
  );

  const onEdit = useCallback(
    async (message: AppendMessage) => {
      const part = message.content[0];
      if (!part || part.type !== "text" || !message.sourceId) return;
      const source = messagesRef.current.find((m) => m.id === message.sourceId);
      if (!source?.serverId) {
        toast.error("El mensaje aún se está guardando; inténtalo de nuevo en un momento.");
        return;
      }
      await runTurn({ text: part.text, attachments: [], replaceServerId: source.serverId });
    },
    [runTurn],
  );

  const onReload = useCallback(
    async (parentId: string | null) => {
      const user = messagesRef.current.find((m) => m.id === parentId);
      if (!user?.serverId) {
        toast.error("No se puede regenerar todavía; inténtalo de nuevo en un momento.");
        return;
      }
      await runTurn({ text: user.content, attachments: [], replaceServerId: user.serverId });
    },
    [runTurn],
  );

  /** Responde a un run en pausa (formulario o aprobación) y sigue el resto del turno. */
  const resumeRun = useCallback(
    async (runId: string, entries: ResumeEntryInput[]) => {
      const target = messagesRef.current.find((m) => m.runId === runId);
      if (!target) return;
      const assistantId = target.id;
      const controller = beginFollow();
      // La pausa deja de estar vigente en pantalla desde ya.
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, interrupts: [], status: "running" } : m)),
      );
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resume: { runId, entries } }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error ?? `Error del servidor (${res.status})`);
        }
        const seed = statesRef.current.get(assistantId);
        await consumeRun({ assistantId, controller, initial: res, seed });
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          const message = error instanceof Error ? error.message : "No se pudo reanudar";
          toast.error(message);
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, status: "error", error: message } : m)),
          );
        }
        endFollow(controller);
      }
    },
    [beginFollow, endFollow, consumeRun],
  );

  const onAddToolResult = useCallback(
    async (options: AddToolResultOptions) => {
      const message = messagesRef.current.find((m) => m.id === options.messageId);
      if (!message?.runId) return;
      await resumeRun(message.runId, [
        {
          callId: options.toolCallId,
          status: "resolved",
          payload: options.result,
        },
      ]);
    },
    [resumeRun],
  );

  const onCancel = useCallback(async () => {
    cancelRequestedRef.current = true;
    // El run vive en el servidor: hay que pedirle que pare, no solo cerrar la conexión.
    const runId = runIdRef.current;
    if (runId) {
      void fetch(`/api/runs/${runId}/cancel`, { method: "POST" }).catch(() => {});
    }
    followRef.current?.abort();
  }, []);

  const rate = useCallback((serverId: string, rating: 1 | -1 | null) => {
    setMessages((prev) => prev.map((m) => (m.serverId === serverId ? { ...m, rating } : m)));
    void fetch(`/api/messages/${serverId}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rating }),
    }).then((res) => {
      if (!res.ok) toast.error("No se pudo guardar tu valoración");
    });
  }, []);

  // --- runtime de assistant-ui ---------------------------------------------

  const convertMessage = useCallback((message: UiMessage): ThreadMessageLike => {
    const content: Record<string, unknown>[] = [];
    const toolPart = (tool: UiToolCall): Record<string, unknown> => {
      const done = tool.status === "complete" || tool.status === "error";
      if (tool.kind === "openui") {
        const ui = String((tool.input as { ui?: string } | undefined)?.ui ?? "");
        return {
          type: "tool-call",
          toolCallId: tool.id,
          toolName: OPENUI_TOOL_NAME,
          args: { ui },
          argsText: JSON.stringify({ ui }),
          result: done ? "" : undefined,
        };
      }
      return {
        type: "tool-call",
        toolCallId: tool.id,
        toolName: tool.name,
        args: tool.input ?? {},
        argsText: tool.argsText ?? JSON.stringify(tool.input ?? {}),
        result: done ? parseToolResult(tool.result) : undefined,
        isError: tool.status === "error" ? true : undefined,
      };
    };

    // El razonamiento que publica el modelo va plegado, antes de la respuesta.
    if (message.role === "assistant" && message.reasoning) content.push({ type: "reasoning", text: message.reasoning });

    if (message.parts && message.parts.length > 0) {
      // Orden real del turno: texto → pasos → texto → interfaz.
      const byId = new Map(message.tools.map((tool) => [tool.id, tool]));
      for (const part of message.parts) {
        if (part.type === "text") {
          if (part.text) content.push({ type: "text", text: part.text });
          continue;
        }
        const tool = byId.get(part.toolId);
        if (tool) content.push(toolPart(tool));
      }
    } else {
      // Mensajes anteriores a las partes ordenadas: herramientas primero, luego prosa y UI.
      for (const tool of message.tools) {
        if (tool.kind !== "openui") content.push(toolPart(tool));
      }
      if (message.content) content.push({ type: "text", text: message.content });
      for (const tool of message.tools) {
        if (tool.kind === "openui") content.push(toolPart(tool));
      }
    }

    if (message.error) {
      content.push({ type: "text", text: `\n\n> ⚠️ ${message.error}` });
    }
    for (const source of message.sources) {
      content.push({
        type: "source",
        sourceType: "url",
        id: String(source.id),
        url: source.url,
        title: source.title ?? source.domain,
      });
    }

    const custom: MessageCustom = {
      serverId: message.serverId,
      runId: message.runId,
      followups: message.followups,
      interrupts: message.interrupts as UiInterrupt[] | undefined,
      rating: message.rating ?? null,
      attachments: message.attachments.map(({ name }) => ({ name })),
    };

    const waiting = (message.interrupts?.length ?? 0) > 0;
    return {
      id: message.id,
      role: message.role,
      content: content as unknown as ThreadMessageLike["content"],
      createdAt: new Date(message.createdAt),
      metadata: { custom: custom as Record<string, unknown> },
      ...(message.role === "assistant"
        ? {
            status: waiting
              ? ({ type: "requires-action", reason: "tool-calls" } as const)
              : message.status === "running"
                ? ({ type: "running" } as const)
                : message.status === "error"
                  ? ({ type: "incomplete", reason: "error" } as const)
                  : ({ type: "complete", reason: "stop" } as const),
          }
        : {}),
    };
  }, []);

  const runtime = useExternalStoreRuntime<UiMessage>({
    messages,
    convertMessage,
    onNew,
    onEdit,
    onReload,
    onCancel,
    onAddToolResult,
    isRunning,
  });

  const actions = useMemo<ChatActions>(
    () => ({
      send: (text) => void runTurn({ text, attachments: [] }),
      resume: (runId, entries) => void resumeRun(runId, entries),
      rate,
      isRunning,
    }),
    [runTurn, resumeRun, rate, isRunning],
  );

  const { setThreadRunning } = shell;
  useEffect(() => {
    if (!isRunning || !currentThreadId) return;
    setThreadRunning(currentThreadId, true);
    return () => setThreadRunning(currentThreadId, false);
  }, [isRunning, currentThreadId, setThreadRunning]);

  const currentThread = shell.threads.find((t) => t.id === currentThreadId) ?? null;
  const activeAgent = agents.find((agent) => agent.id === agentId);
  const activeProject = shell.projects.find((p) => p.id === shell.activeProjectId) ?? null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatActionsProvider value={actions}>
        <div className="relative flex h-svh min-w-0 flex-col">
          <ChatHeader thread={currentThread} />
          <div className="min-h-0 flex-1">
            <ChatThread
              isEmpty={messages.length === 0 && !loadingThread}
              loading={loadingThread && messages.length === 0}
              agentName={activeAgent?.name}
              projectName={currentThreadId ? null : (activeProject?.name ?? null)}
              onClearProject={() => shell.newChat(null)}
              modelGroups={modelGroups}
              selectedModel={selectedModel}
              onModelChange={changeModel}
              agentModel={agentModel}
              starters={agentStarters ?? []}
              skills={availableSkills}
              selectedSkills={selectedSkills}
              onSkillsChange={setSelectedSkills}
              agents={agents}
              agentId={agentId}
              onAgentChange={setAgentId}
              focus={focus}
              mode={mode}
              uiEnabled={uiMode}
              onFocusChange={setFocus}
              onModeChange={setMode}
              onUiChange={setUiMode}
              attachments={pendingAttachments}
              uploading={uploading}
              uploadError={uploadError}
              onFilesSelected={handleFiles}
              onRemoveAttachment={(index) =>
                setPendingAttachments((prev) => prev.filter((_, i) => i !== index))
              }
            />
          </div>
        </div>
      </ChatActionsProvider>
    </AssistantRuntimeProvider>
  );
}
