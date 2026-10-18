import { focusInstruction, researchInstruction } from "@/lib/focus";
import { openuiInstructions } from "@/lib/openui/prompt";

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
  formResult?: PromptFormResult | null;
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
  formResult = null,
}: BuildPromptInput): string {
  const blocks: string[] = [];

  if (mode === "research") blocks.push(researchInstruction());

  const focusText = focus ? focusInstruction(focus) : null;
  if (focusText) blocks.push(focusText);

  if (openui) blocks.push(openuiInstructions());

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
