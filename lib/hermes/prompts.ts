import { focusInstruction, researchInstruction } from "@/lib/focus";
import { openuiInstructions } from "@/lib/openui/prompt";
import type { OpenUiProfile } from "@/lib/openui/profiles";

export interface PromptAttachment {
  name: string;
  text: string;
}

/** Resultado de un formulario OpenUI que el usuario acaba de enviar. */
export interface PromptFormResult {
  formName?: string;
  message: string;
  params: Record<string, unknown>;
  formState?: Record<string, unknown>;
}

export interface BuildPromptInput {
  text: string;
  focus?: string | null;
  mode?: string | null;
  attachments?: PromptAttachment[];
  /** Incluir la librería de UI generativa. Lo decide `openuiToolsEnabled()`. */
  openui?: boolean;
  /** Subconjunto de componentes a anunciar. Por defecto, la librería completa. */
  openuiProfile?: OpenUiProfile;
  formResult?: PromptFormResult | null;
  /**
   * Conversación previa en texto. Solo hace falta cuando la sesión de Hermes no
   * contiene ya esos turnos (edición, regeneración o cambio de motor).
   */
  transcript?: { role: "user" | "assistant"; content: string }[];
  /** Instrucciones propias del agente (Hermes no tiene sistema por petición). */
  agentInstructions?: string;
}

const MAX_TRANSCRIPT_CHARS = 12_000;

function transcriptBlock(transcript: NonNullable<BuildPromptInput["transcript"]>): string {
  const lines: string[] = [];
  let budget = MAX_TRANSCRIPT_CHARS;
  // Se conserva lo más reciente: se recorre desde el final hasta agotar el presupuesto.
  for (const message of [...transcript].reverse()) {
    const label = message.role === "user" ? "Usuario" : "Asistente";
    const text = message.content.slice(0, 3000);
    if (budget - text.length < 0 && lines.length > 0) break;
    budget -= text.length;
    lines.push(`[${label}] ${text}`);
  }
  return `Conversación previa (solo contexto, no la repitas):\n${lines.reverse().join("\n")}`;
}

/**
 * Compone el prompt de un turno.
 *
 * El texto resultante para el camino "clásico" (sin OpenUI, sin formulario) es
 * byte a byte el mismo que producía el BFF antes de este cambio.
 */
export function buildPrompt({
  text,
  focus,
  mode,
  attachments = [],
  openui = false,
  openuiProfile,
  formResult = null,
  transcript = [],
  agentInstructions = "",
}: BuildPromptInput): string {
  const blocks: string[] = [];

  if (agentInstructions.trim()) {
    blocks.push(`Instrucciones de este agente (síguelas):\n${agentInstructions.trim()}`);
  }
  if (transcript.length > 0) blocks.push(transcriptBlock(transcript));

  if (mode === "research") blocks.push(researchInstruction());

  const focusText = focus ? focusInstruction(focus) : null;
  if (focusText) blocks.push(focusText);

  if (openui) blocks.push(openuiInstructions(openuiProfile));

  if (attachments.length > 0) {
    const documents = attachments
      .map((attachment) => `--- ${attachment.name} ---\n${attachment.text}`)
      .join("\n\n");
    blocks.push(`Documentos adjuntos por el usuario (ya extraídos):\n\n${documents}`);
  }

  if (formResult) {
    const payload = JSON.stringify(
      { params: formResult.params, formState: formResult.formState ?? undefined },
      null,
      2,
    );
    blocks.push(
      [
        "El usuario ha enviado un formulario de la interfaz.",
        formResult.formName ? `Formulario: ${formResult.formName}` : "",
        formResult.message ? `Acción elegida: ${formResult.message}` : "",
        "Valores enviados:",
        payload,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  blocks.push(text);
  return blocks.join("\n\n");
}
