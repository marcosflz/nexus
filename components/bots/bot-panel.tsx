"use client";

import { BotExecutionPanel, BotMemoryPanel, BotSkillsPanel } from "./execution-panel";
import { TriggersPanel } from "@/components/agents/triggers-panel";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/ui/markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReasoningNote } from "@/components/rooms/reasoning-note";
import { ToolSteps, type StepCall } from "@/components/rooms/tool-steps";
import { useLiveRun } from "@/components/rooms/use-live-run";
import { DesktopViewer } from "./desktop-viewer";
import {
  ConfigPanel,
  errorOf,
  FilesPanel,
  LogsPanel,
  NewTask,
  POLL_MS,
  post,
  TaskRow,
  type BotInfo,
  type Runtime,
  type Task,
} from "./panels";
import { BotStatusBadge } from "./status";

interface ActivityRun {
  id: string;
  status: string;
  initiator: string;
  prompt: string;
  error: string | null;
  createdAt: string;
  content: string | null;
  tools: StepCall[];
  reasoning: string | null;
}

const TIME = new Intl.DateTimeFormat("es-ES", { dateStyle: "short", timeStyle: "short" });

function LiveRun({ runId }: { runId: string }) {
  const message = useLiveRun(runId);
  if (!message) return <p className="text-muted-fg text-[13px]">Conectando…</p>;
  return (
    <>
      <ToolSteps calls={message.tools} />
      {message.content ? (
        <Markdown className="prose-sm text-[13.5px]">{message.content}</Markdown>
      ) : message.tools.length === 0 ? (
        <p className="text-muted-fg text-[13px]">Pensando…</p>
      ) : null}
    </>
  );
}

/**
 * Lo que el bot va haciendo: el texto que escribe el modelo, cada acción que ejecuta y,
 * si el proveedor lo publica, su razonamiento (o un resumen).
 */
function ActivityPanel({ botId }: { botId: string }) {
  const [runs, setRuns] = useState<ActivityRun[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      const res = await fetch(`/api/bots/${botId}/activity`);
      if (res.ok && !cancelled) setRuns(((await res.json()) as { runs: ActivityRun[] }).runs);
    };
    void read();
    const timer = setInterval(() => void read(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [botId]);

  if (!runs) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (runs.length === 0) return <p className="text-muted-fg text-sm">Este bot todavía no ha hecho nada con un modelo.</p>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <p className="text-muted-fg text-[12px]">
        Acciones y mensajes del bot en cada turno, con su razonamiento cuando el modelo lo publica.
      </p>
      {runs.map((run) => (
        <article key={run.id} className="border-border min-w-0 overflow-hidden rounded-xl border px-3 py-2.5">
          <p className="text-muted-fg flex flex-wrap items-center gap-x-2 text-[12px]">
            <span>{TIME.format(new Date(run.createdAt))}</span>
            <span>·</span>
            <span>{run.initiator === "room" ? "Sala" : "Tarea"}</span>
            <span>·</span>
            <span className={run.status === "error" ? "text-danger" : undefined}>
              {{ running: "En curso", completed: "Terminado", error: "Error", cancelled: "Cancelado", awaiting_input: "Espera aprobación", interrupted: "Interrumpido" }[run.status] ?? run.status}
            </span>
          </p>
          {run.status === "running" ? (
            <LiveRun runId={run.id} />
          ) : (
            <>
              <ReasoningNote text={run.reasoning} />
              <ToolSteps calls={run.tools.filter((tool) => tool.name)} />
              {run.content ? <Markdown className="prose-sm text-[13.5px]">{run.content}</Markdown> : null}
              {run.error ? <p className="text-danger text-[13px] break-words">{run.error}</p> : null}
            </>
          )}
        </article>
      ))}
    </div>
  );
}

interface BotState {
  bot: BotInfo;
  runtime: Runtime["runtime"];
  reachable: boolean;
  configPending: boolean;
}

/**
 * Todo lo de un NexBot en un solo sitio: escritorio, actividad, archivos, tareas,
 * registro, perfiles y configuración. Es su página y también el panel lateral de una sala.
 */
export function BotPanel({
  botId,
  compact = false,
  onDeleted,
  onLoaded,
}: {
  botId: string;
  compact?: boolean;
  onDeleted?: () => void;
  onLoaded?: (bot: BotInfo) => void;
}) {
  const [state, setState] = useState<BotState | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState("activity");

  const refresh = useCallback(async () => {
    const [botRes, tasksRes] = await Promise.all([fetch(`/api/bots/${botId}`), fetch(`/api/bots/${botId}/tasks`)]);
    if (!botRes.ok) {
      setLoadError(await errorOf(botRes, "No se pudo cargar el bot"));
      return;
    }
    const data = (await botRes.json()) as {
      bot: BotInfo;
      runtime: Runtime | null;
      reachable: boolean;
      configPending: boolean;
    };
    setState({
      bot: data.bot,
      runtime: data.runtime?.runtime ?? null,
      reachable: data.reachable,
      configPending: data.configPending,
    });
    onLoaded?.(data.bot);
    if (tasksRes.ok) setTasks(((await tasksRes.json()) as { tasks: Task[] }).tasks);
  }, [botId, onLoaded]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  async function lifecycle(action: "start" | "stop" | "recreate") {
    setBusy(true);
    const res = await post(`/api/bots/${botId}/lifecycle`, { action });
    setBusy(false);
    if (!res.ok) toast.error(await errorOf(res, "No se pudo completar la acción"));
    await refresh();
  }

  async function remove() {
    setConfirmDelete(false);
    const res = await fetch(`/api/bots/${botId}`, { method: "DELETE" });
    if (!res.ok) {
      toast.error(await errorOf(res, "No se pudo borrar el bot"));
      return;
    }
    onDeleted?.();
  }

  if (loadError) {
    return (
      <p role="alert" className="text-danger text-sm">
        {loadError}
      </p>
    );
  }
  if (!state) return <Skeleton className="h-96 w-full rounded-xl" />;

  const { bot, runtime } = state;
  const running = bot.status === "running";
  const hasDesktop = Boolean(runtime?.desktop?.available);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {bot.environmentEnabled ? <BotStatusBadge status={bot.status} /> : <span className="text-muted-fg text-sm">Sin ordenador</span>}
        <Button asChild size="sm" variant="outline"><a href={`/?bot=${botId}`}>Abrir chat</a></Button>
        {running ? (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void lifecycle("recreate")}>
              Recrear
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void lifecycle("stop")}>
              Detener
            </Button>
          </>
        ) : bot.environmentEnabled ? (
          <Button size="sm" disabled={busy} onClick={() => void lifecycle("start")}>
            {busy ? "Arrancando…" : "Arrancar"}
          </Button>
        ) : null}
        {onDeleted ? (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
            Borrar
          </Button>
        ) : null}
      </div>
      {bot.lastError ? (
        <p role="alert" className="border-border text-danger rounded-xl border px-4 py-3 text-sm">
          {bot.lastError}
        </p>
      ) : null}
      {!state.reachable ? (
        <p role="status" className="text-warning text-sm">
          No se puede contactar con el servicio de bots: el estado mostrado puede no estar al día.
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} className="min-w-0">
        <TabsList className={compact ? "mb-3 flex w-full justify-start overflow-x-auto" : "mb-4"}>
          {bot.environmentEnabled ? <TabsTrigger value="desktop">Escritorio</TabsTrigger> : null}
          <TabsTrigger value="activity">Actividad</TabsTrigger>
          {bot.environmentEnabled ? <TabsTrigger value="files">Archivos</TabsTrigger> : null}
          <TabsTrigger value="tasks">Tareas</TabsTrigger>
          {bot.environmentEnabled ? <TabsTrigger value="logs">Registro</TabsTrigger> : null}
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="execution">Ejecución</TabsTrigger>
          <TabsTrigger value="memory">Memoria</TabsTrigger>
          <TabsTrigger value="routines">Rutinas</TabsTrigger>
          <TabsTrigger value="config">Configuración</TabsTrigger>
        </TabsList>
        <TabsContent value="desktop">
          {/* Solo se emite mientras la pestaña está abierta: una emisión por bot a la vista. */}
          {tab === "desktop" ? (
            <DesktopViewer
              botId={botId}
              running={running}
              available={hasDesktop}
              error={runtime?.desktop?.error ?? null}
              idle={runtime?.browserStarted === false}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="activity">{tab === "activity" ? <ActivityPanel botId={botId} /> : null}</TabsContent>
        <TabsContent value="files">
          <FilesPanel botId={botId} running={running} />
        </TabsContent>
        <TabsContent value="tasks" className="grid grid-cols-[minmax(0,1fr)] gap-4">
          {true ? (
            <NewTask
              key={`${hasDesktop}`}
              botId={botId}
              hasProfile
              hasEnvironment={bot.environmentEnabled && running}
              hasDesktop={hasDesktop}
              onCreated={() => void refresh()}
            />
          ) : null}
          {tasks.length === 0 ? (
            <p className="text-muted-fg text-sm">Todavía no hay tareas.</p>
          ) : (
            <ul className="divide-border border-border divide-y rounded-xl border">
              {tasks.map((task) => (
                <TaskRow key={task.id} botId={botId} task={task} onChanged={() => void refresh()} />
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="logs">{tab === "logs" ? <LogsPanel botId={botId} /> : null}</TabsContent>
        <TabsContent value="skills"><BotSkillsPanel key={JSON.stringify(bot.skillIds)} bot={bot} onSaved={() => void refresh()} /></TabsContent>
        <TabsContent value="execution"><BotExecutionPanel key={JSON.stringify([bot.role, bot.execution, bot.environmentEnabled])} bot={bot} onSaved={() => void refresh()} /></TabsContent>
        <TabsContent value="memory">{tab === "memory" ? <BotMemoryPanel botId={botId} /> : null}</TabsContent>
        <TabsContent value="routines">{tab === "routines" ? <TriggersPanel agentId={botId} canEdit /> : null}</TabsContent>
        <TabsContent value="config">
          <ConfigPanel
            key={JSON.stringify([bot.name, bot.description, bot.instructions, bot.config])}
            bot={bot}
            running={running}
            pending={state.configPending}
            busy={busy}
            onSaved={() => void refresh()}
            onRecreate={() => void lifecycle("recreate")}
          />
        </TabsContent>
      </Tabs>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar {bot.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se elimina el bot y su contenedor, y sale de sus salas. Su volumen de datos se conserva en el servidor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
