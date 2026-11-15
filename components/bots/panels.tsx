"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Folder, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BOT_LIMITS, botConfigSchema, isTerminalTask } from "@/lib/bots/spec";
import { describeEvent, TASK_LABEL } from "./status";

/** Paneles de un NexBot. Los usan tanto su página como el panel lateral de una sala. */

export interface BotInfo {
  id: string;
  name: string;
  role: string;
  environmentEnabled: boolean;
  execution: Record<string, unknown>;
  skillIds: string[];
  description: string;
  instructions: string;
  config: unknown;
  status: string;
  lastError: string | null;
}

export interface Runtime {
  runtime?: { currentTask?: string | null; browserStarted?: boolean; desktop?: { available: boolean; error: string | null } } | null;
}

export interface Task {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  artifacts: string[];
  input: { prompt?: string; steps?: unknown[] };
  result: { text?: string } | null;
  createdAt: string;
}

interface TaskDetail {
  approval: { message: string } | null;
  events: Record<string, unknown>[];
}

export interface FileEntry {
  name: string;
  dir: boolean;
  size: number;
}

const DATE_TIME = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" });
export const POLL_MS = 3000;

export async function errorOf(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return data.error ?? fallback;
}

export const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function NewTask({
  botId,
  hasProfile,
  hasEnvironment = true,
  hasDesktop,
  onCreated,
}: {
  botId: string;
  hasProfile: boolean;
  hasEnvironment?: boolean;
  hasDesktop: boolean;
  onCreated: () => void;
}) {
  const [mode, setMode] = useState<"computer" | "agent" | "plan">(
    hasDesktop ? "computer" : "agent",
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    let body: unknown = { kind: mode, prompt: text };
    if (mode === "plan") {
      let steps: unknown;
      try {
        steps = JSON.parse(text);
      } catch {
        toast.error("El plan debe ser una lista JSON de pasos");
        return;
      }
      body = { kind: "plan", steps };
    }
    setBusy(true);
    const res = await post(`/api/bots/${botId}/tasks`, body);
    setBusy(false);
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo crear la tarea"));
      return;
    }
    setText("");
    onCreated();
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="bot-task">Nueva tarea</Label>
        <div className="flex gap-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "computer" ? "secondary" : "ghost"}
            disabled={!hasDesktop}
            title={hasDesktop ? "El modelo ve la pantalla y actúa solo dentro de este bot" : "Este bot no tiene escritorio"}
            onClick={() => setMode("computer")}
          >
            Ordenador
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "agent" ? "secondary" : "ghost"}
            title="Usa la configuración y las skills de este Nexbot"
            onClick={() => setMode("agent")}
          >
            Instrucción
          </Button>
          <Button type="button" size="sm" disabled={!hasEnvironment} variant={mode === "plan" ? "secondary" : "ghost"} onClick={() => setMode("plan")}>
            Plan JSON
          </Button>
        </div>
      </div>
      <Textarea
        id="bot-task"
        rows={mode === "plan" ? 5 : 2}
        required
        className={mode === "plan" ? "font-mono text-[13px]" : undefined}
        placeholder={
          mode === "plan" ? '[{"action":"goto","url":"https://example.com/"}]' : "Qué quieres que haga el bot"
        }
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex justify-end">
        <Button type="submit" size="sm" className="rounded-full" disabled={busy}>
          {busy ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </form>
  );
}

export function TaskRow({ botId, task, onChanged }: { botId: string; task: Task; onChanged: () => void }) {
  const active = !isTerminalTask(task.status);
  const [detail, setDetail] = useState<TaskDetail | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const read = async () => {
      const res = await fetch(`/api/bots/${botId}/tasks/${task.id}`);
      if (res.ok && !cancelled) setDetail((await res.json()) as TaskDetail);
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [botId, task.id, active]);

  async function act(action: "cancel" | "approve" | "deny") {
    const res = await post(`/api/bots/${botId}/tasks/${task.id}`, { action });
    if (!res.ok) toast.error(await errorOf(res, "No se pudo aplicar la acción"));
    onChanged();
  }

  const steps = (detail?.events ?? []).map(describeEvent).filter(Boolean).slice(-5);
  const summary = task.input.prompt ?? `Plan de ${task.input.steps?.length ?? 0} pasos`;

  return (
    <li className="grid gap-1.5 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px]">{summary}</p>
          <p className="text-muted-fg text-[12px]">
            {TASK_LABEL[task.status] ?? task.status} · {DATE_TIME.format(new Date(task.createdAt))}
          </p>
        </div>
        {task.status === "awaiting_approval" && task.kind === "plan" ? (
          <>
            <Button size="sm" onClick={() => void act("approve")}>
              Aprobar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void act("deny")}>
              Denegar
            </Button>
          </>
        ) : null}
        {task.status === "awaiting_approval" && task.kind !== "plan" ? (
          <Button size="sm" variant="outline" asChild>
            <Link href="/inbox">Decidir en la Bandeja</Link>
          </Button>
        ) : null}
        {active ? (
          <Button size="sm" variant="ghost" onClick={() => void act("cancel")}>
            Cancelar
          </Button>
        ) : null}
      </div>
      {detail?.approval ? <p className="text-warning text-[13px]">{detail.approval.message}</p> : null}
      {task.error ? <p className="text-danger text-[13px] break-words">{task.error}</p> : null}
      {task.result?.text ? <p className="text-[13px] break-words whitespace-pre-wrap">{task.result.text}</p> : null}
      {steps.length > 0 ? (
        <ol className="text-muted-fg grid gap-0.5 text-[12px]">
          {steps.map((step, index) => (
            <li key={`${index}-${step}`} className="truncate">
              {step}
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

export function FilesPanel({ botId, running }: { botId: string; running: boolean }) {
  const [path, setPath] = useState("");
  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    void fetch(`/api/bots/${botId}/files?path=${encodeURIComponent(path)}`).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(await errorOf(res, "No se pudo leer el directorio"));
        return;
      }
      setError(null);
      setEntries(((await res.json()) as { entries: FileEntry[] }).entries);
    });
    return () => {
      cancelled = true;
    };
  }, [botId, path, running]);

  if (!running) return <p className="text-muted-fg text-sm">Arranca el bot para ver sus archivos.</p>;
  if (error) return <p role="alert" className="text-danger text-sm">{error}</p>;
  if (!entries) return <Skeleton className="h-24 w-full rounded-xl" />;

  const parent = path.split("/").slice(0, -1).join("/");
  return (
    <div className="border-border overflow-hidden rounded-xl border">
      <p className="border-border text-muted-fg border-b px-4 py-2 font-mono text-[12px]">workspace/{path}</p>
      <ul className="divide-border divide-y">
        {path ? (
          <li>
            <button type="button" className="hover:bg-surface-2/60 w-full px-4 py-2 text-left text-sm" onClick={() => setPath(parent)}>
              ..
            </button>
          </li>
        ) : null}
        {entries.map((entry) => {
          const child = path ? `${path}/${entry.name}` : entry.name;
          return (
            <li key={entry.name}>
              {entry.dir ? (
                <button
                  type="button"
                  className="hover:bg-surface-2/60 flex w-full items-center gap-2 px-4 py-2 text-left text-sm"
                  onClick={() => setPath(child)}
                >
                  <Folder className="size-4" /> {entry.name}
                </button>
              ) : (
                <a
                  href={`/api/bots/${botId}/files?path=${encodeURIComponent(child)}&download=1`}
                  className="hover:bg-surface-2/60 flex items-center gap-2 px-4 py-2 text-sm"
                >
                  <FileText className="size-4" /> {entry.name}
                  <span className="text-muted-fg ml-auto text-[12px]">{(entry.size / 1024).toFixed(1)} KB</span>
                </a>
              )}
            </li>
          );
        })}
        {entries.length === 0 ? <li className="text-muted-fg px-4 py-3 text-sm">Directorio vacío.</li> : null}
      </ul>
    </div>
  );
}

export function LogsPanel({ botId }: { botId: string }) {
  const [lines, setLines] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/bots/${botId}/logs`).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) {
        setLines([await errorOf(res, "No se pudo leer el registro")]);
        return;
      }
      const data = (await res.json()) as { lines: unknown[] };
      setLines(
        data.lines.map((line) => {
          if (typeof line === "string") return line;
          const entry = line as { ts?: number; level?: string; msg?: string; data?: unknown };
          const stamp = entry.ts ? new Date(entry.ts * 1000).toISOString().slice(11, 19) : "";
          return `${stamp} ${entry.level ?? ""} ${entry.msg ?? ""} ${entry.data ? JSON.stringify(entry.data) : ""}`;
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [botId]);

  if (!lines) return <Skeleton className="h-24 w-full rounded-xl" />;
  return (
    <pre className="border-border bg-surface-2 max-h-96 overflow-auto rounded-xl border p-3 text-[12px] whitespace-pre-wrap">
      {lines.join("\n") || "Sin registros."}
    </pre>
  );
}

function ConfigSwitch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex items-center justify-between gap-4"><span><span className="block text-sm">{label}</span><span className="text-muted-fg text-xs">{hint}</span></span><Switch checked={checked} onCheckedChange={onChange} /></label>;
}

function ConfigNumber({ id, label, hint, limits, step = 1, value, onChange }: { id: string; label: string; hint: string; limits: { min: number; max: number }; step?: number; value: string; onChange: (value: string) => void }) {
  return <div className="grid gap-1"><Label htmlFor={id}>{label}</Label><Input id={id} type="number" min={limits.min} max={limits.max} step={step} value={value} onChange={(event) => onChange(event.target.value)} /><p className="text-muted-fg text-xs">{hint}</p></div>;
}

export function ConfigPanel({
  bot,
  running,
  pending,
  busy,
  onSaved,
  onRecreate,
}: {
  bot: BotInfo;
  running: boolean;
  pending: boolean;
  busy: boolean;
  onSaved: () => void;
  onRecreate: () => void;
}) {
  const saved = botConfigSchema.parse(bot.config ?? {});
  const [name, setName] = useState(bot.name);
  const [description, setDescription] = useState(bot.description);
  const [instructions, setInstructions] = useState(bot.instructions);
  const [desktop, setDesktop] = useState(saved.desktop);
  const [persistBrowser, setPersistBrowser] = useState(saved.persistBrowser);
  const [offline, setOffline] = useState(saved.network === "none");
  const [memoryMb, setMemoryMb] = useState(String(saved.memoryMb));
  const [cpus, setCpus] = useState(String(saved.cpus));
  const [diskMb, setDiskMb] = useState(String(saved.diskMb));
  const [taskTimeoutS, setTaskTimeoutS] = useState(String(saved.taskTimeoutS));
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    const res = await fetch(`/api/bots/${bot.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        instructions,
        config: {
          desktop,
          persistBrowser,
          network: offline ? "none" : "restricted",
          memoryMb: Number(memoryMb),
          cpus: Number(cpus),
          diskMb: Number(diskMb),
          taskTimeoutS: Number(taskTimeoutS),
        },
      }),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo guardar"));
      return;
    }
    toast.success("Configuración guardada");
    onSaved();
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] max-w-2xl gap-5">
      {pending ? (
        <div role="status" className="border-border grid gap-2 rounded-xl border px-4 py-3 text-sm">
          <p>
            {running
              ? "El contenedor sigue con la configuración anterior. Al recrearlo se interrumpe lo que esté haciendo el bot; sus archivos se conservan."
              : "Los cambios se aplicarán la próxima vez que arranques el bot."}
          </p>
          {running ? (
            <div>
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onRecreate}>
                {busy ? "Recreando…" : "Recrear ahora"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <Label htmlFor="config-name">Nombre</Label>
        <Input id="config-name" required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <Label htmlFor="config-description">Descripción</Label>
        <Input
          id="config-description"
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <Label htmlFor="config-instructions">Instrucciones</Label>
        <Textarea
          id="config-instructions"
          rows={4}
          maxLength={8000}
          placeholder="Quién es este bot y cómo debe trabajar"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
        />
        <p className="text-muted-fg text-[12px]">Se usan desde la siguiente tarea, sin reiniciar el bot.</p>
      </div>

      <div className="border-border grid gap-4 border-t pt-5">
        <div>
          <h3 className="text-sm font-medium">Entorno</h3>
          <p className="text-muted-fg text-[12px]">Estos ajustes se aplican al arrancar o recrear el contenedor.</p>
        </div>
        <ConfigSwitch
          label="Escritorio visible"
          hint="Necesario para ver al bot en directo y para las tareas de Ordenador."
          checked={desktop}
          onChange={setDesktop}
        />
        <ConfigSwitch
          label="Conservar sesiones web"
          hint="Guarda cookies en su volumen, sin cifrar."
          checked={persistBrowser}
          onChange={setPersistBrowser}
        />
        <ConfigSwitch
          label="Sin internet"
          hint="El bot no podrá salir a ninguna web."
          checked={offline}
          onChange={setOffline}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <ConfigNumber
            id="config-memory"
            label="Memoria (MB)"
            hint="Límite del contenedor."
            limits={BOT_LIMITS.memoryMb}
            value={memoryMb}
            onChange={setMemoryMb}
          />
          <ConfigNumber
            id="config-cpus"
            label="CPU (núcleos)"
            hint="Límite del contenedor."
            limits={BOT_LIMITS.cpus}
            step={0.25}
            value={cpus}
            onChange={setCpus}
          />
          <ConfigNumber
            id="config-disk"
            label="Disco (MB)"
            hint="Cuota de su volumen."
            limits={BOT_LIMITS.diskMb}
            value={diskMb}
            onChange={setDiskMb}
          />
          <ConfigNumber
            id="config-timeout"
            label="Tiempo por plan (s)"
            hint="Máximo de cada Plan JSON."
            limits={BOT_LIMITS.taskTimeoutS}
            value={taskTimeoutS}
            onChange={setTaskTimeoutS}
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="submit" size="sm" className="rounded-full" disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </form>
  );
}
