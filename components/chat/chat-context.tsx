"use client";

import { createContext, useContext } from "react";
import type { ResumeEntryInput } from "@/lib/runs/launch";

/** Acciones de la conversación que necesitan los componentes de los mensajes. */
export interface ChatActions {
  /** Envía un mensaje nuevo (p. ej. una pregunta de seguimiento). */
  send(text: string): void;
  /** Responde a un run en pausa (aprobación o formulario). */
  resume(runId: string, entries: ResumeEntryInput[]): void;
  /** Valoración de una respuesta. `null` la retira. */
  rate(serverId: string, rating: 1 | -1 | null): void;
  isRunning: boolean;
}

const noop = () => {};
const ChatActionsContext = createContext<ChatActions>({
  send: noop,
  resume: noop,
  rate: noop,
  isRunning: false,
});

export const ChatActionsProvider = ChatActionsContext.Provider;
export const useChatActions = () => useContext(ChatActionsContext);

/** Datos propios de Nexus que viajan en `metadata.custom` de cada mensaje. */
export interface MessageCustom {
  serverId?: string;
  runId?: string;
  followups?: string[];
  interrupts?: {
    id: string;
    reason: string;
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    payload?: Record<string, unknown>;
  }[];
  rating?: 1 | -1 | null;
  attachments?: { name: string }[];
}
