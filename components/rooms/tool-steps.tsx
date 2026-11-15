import { Check, Loader2, X } from "lucide-react";

export interface StepCall {
  id: string;
  name: string;
  input?: unknown;
  argsText?: string;
  status: "running" | "complete" | "error";
}

function argsOf(call: StepCall): Record<string, unknown> {
  if (call.input && typeof call.input === "object") return call.input as Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(call.argsText ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const short = (value: unknown, max = 70) => {
  const text = typeof value === "string" ? value : value === undefined ? "" : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

/** Qué hizo el bot, en una línea. Los argumentos vienen del modelo: se muestran como texto. */
export function describeStep(call: StepCall): string {
  const args = argsOf(call);
  switch (call.name.replace(/^nexbot__/, "")) {
    case "activate_skill": return `Activa la skill ${short(args.skill)}`;
    case "read_skill_file": return `Lee ${short(args.path)} de ${short(args.skill)}`;
    case "run_skill_script": return `Ejecuta ${short(args.path)} de ${short(args.skill)}`;
    case "desktop_open_url":
      return `Abre ${short(args.url)}`;
    case "desktop_click":
      return `Clic en (${short(args.x)}, ${short(args.y)})`;
    case "desktop_type":
      return `Escribe «${short(args.text, 50)}»`;
    case "desktop_key":
      return `Pulsa ${short(args.key ?? args.combo)}`;
    case "desktop_scroll":
      return "Desplaza la página";
    case "desktop_screenshot":
      return "Mira la pantalla";
    case "desktop_wait":
      return "Espera";
    case "workspace_write":
      return `Guarda ${short(args.path)}`;
    case "workspace_read":
      return `Lee ${short(args.path)}`;
    case "workspace_list":
      return `Lista ${short(args.path) || "su workspace"}`;
    case "board_list":
      return "Consulta el tablero";
    case "board_create_subtask":
      return `Crea la subtarea «${short(args.title, 60)}»${args.assignee ? ` para @${short(args.assignee)}` : ""}`;
    case "board_set_status":
      return `Cambia el estado a ${short(args.status)}`;
    case "board_assign":
      return `Asigna la tarea a @${short(args.assignee)}`;
    case "board_add_blocker":
      return "Marca un bloqueo";
    default:
      return call.name;
  }
}

export function ToolSteps({ calls }: { calls: StepCall[] }) {
  if (calls.length === 0) return null;
  return (
    <ol className="border-border text-muted-fg my-2 ml-1 grid gap-1 border-l pl-3 text-[12.5px]">
      {calls.map((call) => (
        <li key={call.id} className="flex min-w-0 items-center gap-2">
          {call.status === "running" ? (
            <Loader2 className="text-brand size-3 shrink-0 animate-spin" />
          ) : call.status === "error" ? (
            <X className="text-danger size-3 shrink-0" />
          ) : (
            <Check className="size-3 shrink-0" />
          )}
          <span className="truncate">{describeStep(call)}</span>
        </li>
      ))}
    </ol>
  );
}
