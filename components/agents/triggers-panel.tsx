"use client";

import { useCallback, useEffect, useState } from "react";
import { Copy, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface Trigger {
  id: string;
  kind: "cron" | "webhook" | "rss" | "watch" | "agent_completed";
  name: string;
  prompt: string;
  config: Record<string, unknown>;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  failureCount: number;
}

const KIND_LABEL: Record<Trigger["kind"], string> = {
  cron: "Programado (cron)",
  webhook: "Webhook entrante",
  rss: "Feed RSS / Atom",
  watch: "Vigilar una página",
  agent_completed: "Cuando otro agente termina",
};

function describe(trigger: Trigger): string {
  const c = trigger.config;
  switch (trigger.kind) {
    case "cron":
      return `${c.expr} (${c.tz})`;
    case "rss":
    case "watch":
      return `${c.url} · cada ${c.intervalMin} min`;
    case "webhook":
      return "POST a la URL secreta del webhook";
    case "agent_completed":
      return "Se dispara al terminar el agente elegido";
  }
}

export function TriggersPanel({ agentId, canEdit }: { agentId: string; canEdit: boolean }) {
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; mine: boolean }[]>([]);
  const [kind, setKind] = useState<Trigger["kind"]>("cron");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [expr, setExpr] = useState("0 9 * * 1-5");
  const [tz, setTz] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [url, setUrl] = useState("");
  const [intervalMin, setIntervalMin] = useState(60);
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [runNow, setRunNow] = useState("");
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/agents/${agentId}/triggers`);
    if (res.ok) setTriggers(((await res.json()) as { triggers: Trigger[] }).triggers);
  }, [agentId]);

  useEffect(() => {
    void load();
    fetch("/api/agents")
      .then((res) => (res.ok ? res.json() : { agents: [] }))
      .then((data: { agents: { id: string; name: string; mine: boolean }[] }) =>
        setAgents(data.agents.filter((agent) => agent.mine && agent.id !== agentId)),
      )
      .catch(() => {});
  }, [load, agentId]);

  async function create() {
    setBusy(true);
    const config =
      kind === "cron" ? { expr, tz } : kind === "rss" || kind === "watch" ? { url, intervalMin } : kind === "agent_completed" ? { sourceAgentId: source } : {};
    try {
      const res = await fetch(`/api/agents/${agentId}/triggers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, prompt, config }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; webhookUrl?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear");
      setWebhookUrl(data.webhookUrl ?? null);
      setName("");
      setPrompt("");
      toast.success("Disparador creado");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(trigger: Trigger, enabled: boolean) {
    const res = await fetch(`/api/agents/${agentId}/triggers/${trigger.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) toast.error("No se pudo cambiar");
    await load();
  }

  async function remove(trigger: Trigger) {
    const res = await fetch(`/api/agents/${agentId}/triggers/${trigger.id}`, { method: "DELETE" });
    if (!res.ok) toast.error("No se pudo eliminar");
    await load();
  }

  async function runAgentNow() {
    const res = await fetch(`/api/agents/${agentId}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: runNow }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return toast.error(data.error ?? "No se pudo lanzar");
    toast.success("Lanzado. Verás el resultado en la bandeja.");
    setRunNow("");
  }

  return (
    <div className="space-y-6">
      {canEdit ? (
        <div className="space-y-2 border-border bg-surface rounded-xl border p-4">
          <h3 className="text-sm font-medium">Ejecutar ahora</h3>
          <div className="flex gap-2">
            <Input value={runNow} onChange={(e) => setRunNow(e.target.value)} placeholder="Qué tiene que hacer el agente" />
            <Button onClick={runAgentNow} disabled={!runNow.trim()}>
              <Play className="size-4" /> Lanzar
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Trabaja por su cuenta, sin que estés delante: las acciones con efectos te pedirán aprobación en la bandeja.
          </p>
        </div>
      ) : null}

      <ul className="space-y-2">
        {triggers.map((trigger) => (
          <li key={trigger.id} className="space-y-1 border-border bg-surface rounded-xl border p-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="outline">{KIND_LABEL[trigger.kind]}</Badge>
              <span className="min-w-0 flex-1 truncate font-medium">{trigger.name}</span>
              {trigger.failureCount > 0 ? <Badge variant="destructive">{trigger.failureCount} fallos</Badge> : null}
              <Switch checked={trigger.enabled} disabled={!canEdit} onCheckedChange={(on) => toggle(trigger, on)} aria-label="Activo" />
              {canEdit ? (
                <Button variant="ghost" size="icon-sm" aria-label="Eliminar disparador" onClick={() => remove(trigger)}>
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground truncate text-xs">{describe(trigger)}</p>
            {trigger.nextRunAt ? (
              <p className="text-muted-foreground text-xs">Próxima: {new Date(trigger.nextRunAt).toLocaleString("es")}</p>
            ) : null}
          </li>
        ))}
        {triggers.length === 0 ? <li className="text-muted-foreground text-sm">Sin disparadores todavía.</li> : null}
      </ul>

      {webhookUrl ? (
        <div className="border-border bg-surface rounded-xl border border-primary/40 bg-primary/10 p-3 text-sm">
          <p className="mb-1 font-medium">URL del webhook (se muestra solo ahora)</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{webhookUrl}</code>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Copiar"
              onClick={() => void navigator.clipboard.writeText(webhookUrl).then(() => toast.success("Copiada"))}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {canEdit ? (
        <div className="space-y-3 border-border bg-surface rounded-xl border p-4">
          <h3 className="text-sm font-medium">Nuevo disparador</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tipo</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Trigger["kind"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(KIND_LABEL).map(([id, label]) => (
                    <SelectItem key={id} value={id}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Nombre</Label>
              <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Resumen matinal" />
            </div>
          </div>
          {kind === "cron" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Expresión cron</Label>
                <Input value={expr} onChange={(e) => setExpr(e.target.value)} />
                <p className="text-muted-foreground text-xs">Mínimo cada 5 minutos. «0 9 * * 1-5» = laborables a las 9:00.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Zona horaria</Label>
                <Input value={tz} onChange={(e) => setTz(e.target.value)} />
              </div>
            </div>
          ) : null}
          {kind === "rss" || kind === "watch" ? (
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <div className="space-y-1.5">
                <Label>URL</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
              </div>
              <div className="space-y-1.5">
                <Label>Cada (min)</Label>
                <Input type="number" min={15} value={intervalMin} onChange={(e) => setIntervalMin(Number(e.target.value) || 60)} />
              </div>
            </div>
          ) : null}
          {kind === "agent_completed" ? (
            <div className="space-y-1.5">
              <Label>Agente que se espera</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue placeholder="Elige uno de tus agentes" /></SelectTrigger>
                <SelectContent>
                  {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Qué hacer cuando se dispare</Label>
            <Textarea value={prompt} rows={2} maxLength={4000} onChange={(e) => setPrompt(e.target.value)} placeholder="Resume las novedades y destaca lo importante." />
          </div>
          <Button onClick={create} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
            Crear disparador
          </Button>
        </div>
      ) : null}
    </div>
  );
}
