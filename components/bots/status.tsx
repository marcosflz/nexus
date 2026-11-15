import { Badge } from "@/components/ui/badge";

const BOT_LABEL: Record<string, string> = {
  running: "En marcha",
  starting: "Arrancando",
  stopped: "Detenido",
  error: "Error",
};

export function BotStatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={status === "error" ? "destructive" : "outline"} className="rounded-full">
      {BOT_LABEL[status] ?? status}
    </Badge>
  );
}

export const TASK_LABEL: Record<string, string> = {
  queued: "En cola",
  running: "En curso",
  awaiting_approval: "Espera aprobación",
  succeeded: "Completada",
  failed: "Fallida",
  timeout: "Tiempo agotado",
  cancelled: "Cancelada",
  denied: "Denegada",
  interrupted: "Interrumpida",
};

/** Una línea legible de un evento del journal. Sus valores vienen del bot: se muestran como texto. */
export function describeEvent(event: Record<string, unknown>): string {
  const type = String(event.type ?? "");
  if (type === "step_started") {
    const detail = event.url ?? event.selector ?? event.path ?? event.key ?? (event.x !== undefined ? `${event.x}, ${event.y}` : "");
    return `${String(event.action ?? "paso")}${detail ? ` · ${String(detail)}` : ""}`;
  }
  if (type === "step_done") return "";
  return TASK_LABEL[type] ?? type;
}
