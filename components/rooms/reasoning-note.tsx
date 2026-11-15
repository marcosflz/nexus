import { Brain } from "lucide-react";

/**
 * Razonamiento (o su resumen) que publicó el modelo en un turno. Va plegado y solo
 * al terminar (mientras trabaja ya se ven sus pasos): es contexto para entender al
 * bot, no parte de su respuesta.
 */
export function ReasoningNote({ text }: { text?: string | null }) {
  if (!text?.trim()) return null;
  return (
    <details className="border-border my-2 rounded-lg border px-3 py-2 text-[13px]">
      <summary className="text-muted-fg flex cursor-pointer list-none items-center gap-1.5 select-none">
        <Brain className="size-3.5" /> Razonamiento
      </summary>
      <p className="text-muted-fg mt-2 max-h-64 overflow-y-auto break-words whitespace-pre-wrap">{text}</p>
    </details>
  );
}
