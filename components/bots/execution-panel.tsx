"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { KnowledgePanel } from "@/components/agents/knowledge-panel";
import { runtimeSettingsSchema, type RuntimeSettings } from "@/lib/runtime/spec";
import { AGENT_TOOL_IDS } from "@/lib/agents/spec";
import { OPENUI_PROFILES } from "@/lib/openui/profiles";
import { api } from "@/components/skills/client";
import type { BotInfo } from "./panels";

const TOOL_LABEL: Record<string, string> = { web_search: "Buscar en la web", web_fetch: "Leer páginas", present_openui: "Presentar interfaces", prompt_openui: "Pedir datos con formularios", suggest_followups: "Sugerir próximos pasos" };

export function BotExecutionPanel({ bot, onSaved }: { bot: BotInfo; onSaved: () => void }) {
  const [settings, setSettings] = useState(() => runtimeSettingsSchema.parse(bot.execution ?? {}));
  const [role, setRole] = useState(bot.role ?? "");
  const [environment, setEnvironment] = useState(bot.environmentEnabled);
  const [busy, setBusy] = useState(false);
  const [groups, setGroups] = useState<{ provider: string; label: string; models: { id: string; label: string }[] }[]>([]);
  const [connectors, setConnectors] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    void api<{ groups: typeof groups }>("/api/models").then((data) => setGroups(data.groups)).catch(() => {});
    void api<{ connectors: typeof connectors }>("/api/connectors").then((data) => setConnectors(data.connectors)).catch(() => {});
  }, []);
  function patch<T extends keyof RuntimeSettings>(key: T, value: RuntimeSettings[T]) { setSettings((old) => ({ ...old, [key]: value })); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { await api(`/api/bots/${bot.id}`, { execution: settings, role, environmentEnabled: environment }, "PATCH"); toast.success("Configuración del Nexbot guardada"); onSaved(); }
    catch (error) { toast.error(String(error)); }
    finally { setBusy(false); }
  }
  const budgetLabels = { maxRunsPerDay: "Ejecuciones por día", maxTokensPerRun: "Tokens por ejecución", maxTokensPerDay: "Tokens por día", maxToolCalls: "Llamadas a herramientas" };
  return <form onSubmit={(event) => void save(event)} className="grid gap-5">
    <div className="grid gap-2"><Label htmlFor="nexbot-role">Rol</Label><Input id="nexbot-role" value={role} maxLength={200} onChange={(event) => setRole(event.target.value)} placeholder="Analista de investigación, editor, asistente personal…" /></div>
    <div className="grid gap-2"><Label htmlFor="nexbot-model">Modelo</Label><select id="nexbot-model" className="border-border bg-bg rounded-lg border p-2 text-sm" value={settings.model.provider && settings.model.model ? JSON.stringify([settings.model.provider, settings.model.model]) : ""} onChange={(event) => { const selected = event.target.value ? JSON.parse(event.target.value) as string[] : []; patch("model", selected.length ? { provider: selected[0], model: selected[1] } : {}); }}><option value="">Heredar el predeterminado de mi cuenta</option>{groups.map((group) => <optgroup key={group.provider} label={group.label}>{group.models.map((model) => <option key={model.id} value={JSON.stringify([group.provider, model.id])}>{model.label}</option>)}</optgroup>)}</select></div>
    <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-medium">Herramientas</legend>{AGENT_TOOL_IDS.map((tool) => <label key={tool} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={settings.tools.includes(tool)} onChange={(event) => patch("tools", event.target.checked ? [...settings.tools, tool] : settings.tools.filter((value) => value !== tool))} />{TOOL_LABEL[tool]}</label>)}</fieldset>
    <fieldset className="grid gap-2"><legend className="mb-2 text-sm font-medium">Conectores</legend>{connectors.length ? connectors.map((connector) => <label className="flex items-center gap-2 text-sm" key={connector.id}><input type="checkbox" checked={settings.connectors.some((item) => item.connectorId === connector.id)} onChange={(event) => patch("connectors", event.target.checked ? [...settings.connectors, { connectorId: connector.id }] : settings.connectors.filter((item) => item.connectorId !== connector.id))} />{connector.name}</label>) : <p className="text-muted-fg text-sm">Añade conectores desde Ajustes para poder asignarlos.</p>}</fieldset>
    <label className="flex items-center justify-between gap-4 text-sm"><span>Ordenador propio opcional<span className="text-muted-fg mt-1 block text-xs">Archivos persistentes, navegador, escritorio y scripts de skills.</span></span><Switch checked={environment} onCheckedChange={setEnvironment} /></label>
    <label className="flex items-center justify-between text-sm">Memoria duradera<Switch checked={settings.memory.enabled} onCheckedChange={(enabled) => patch("memory", { ...settings.memory, enabled })} /></label>
    {settings.memory.enabled ? <select aria-label="Ámbito de memoria" className="border-border bg-bg rounded-lg border p-2 text-sm" value={settings.memory.scope} onChange={(event) => patch("memory", { ...settings.memory, scope: event.target.value as "bot" | "user" })}><option value="bot">Solo este Nexbot</option><option value="user">Memoria personal compartida de mi cuenta</option></select> : null}
    <KnowledgePanel agentId={bot.id} enabled={settings.knowledge.enabled} topK={settings.knowledge.topK} canEdit onChange={(value) => patch("knowledge", value)} />
    <details className="border-border rounded-xl border p-3"><summary className="cursor-pointer text-sm font-medium">Límites, respuesta y políticas</summary><div className="mt-4 grid gap-4">
      <p className="text-muted-fg text-xs">Un límite de 0 no añade restricciones a los límites de tu cuenta.</p><div className="grid gap-3 sm:grid-cols-2">{(Object.keys(budgetLabels) as (keyof typeof budgetLabels)[]).map((key) => <label className="grid gap-1 text-sm" key={key}>{budgetLabels[key]}<Input type="number" min={0} value={settings.budgets[key]} onChange={(event) => patch("budgets", { ...settings.budgets, [key]: Number(event.target.value) })} /></label>)}</div>
      <label className="grid gap-1 text-sm">Preguntas de inicio, una por línea<Textarea value={settings.starters.join("\n")} onChange={(event) => patch("starters", event.target.value.split("\n").filter(Boolean).slice(0, 6))} /></label>
      <label className="flex justify-between text-sm">Sugerencias de seguimiento<Switch checked={settings.followups} onCheckedChange={(value) => patch("followups", value)} /></label>
      <label className="grid gap-1 text-sm">Interfaz generativa<select className="border-border bg-bg rounded-lg border p-2" value={settings.ui.openui} onChange={(event) => patch("ui", { ...settings.ui, openui: event.target.value as "off" | "auto" | "always" })}><option value="off">Desactivada</option><option value="auto">Automática</option><option value="always">Preferir interfaces</option></select></label>
      <fieldset className="flex flex-wrap gap-3"><legend className="mb-2 text-sm">Componentes disponibles</legend>{OPENUI_PROFILES.map((profile) => <label key={profile} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={settings.ui.profiles.includes(profile)} onChange={(event) => { const profiles = event.target.checked ? [...settings.ui.profiles, profile] : settings.ui.profiles.filter((value) => value !== profile); if (profiles.length) patch("ui", { ...settings.ui, profiles }); }} />{profile}</label>)}</fieldset>
      {([ ["allowHosts", "Dominios permitidos"], ["askTools", "Herramientas que requieren aprobación"], ["allowTools", "Herramientas permitidas"] ] as const).map(([key, label]) => <label className="grid gap-1 text-sm" key={key}>{label}<Input value={settings.policy[key].join(", ")} placeholder="Separados por comas" onChange={(event) => patch("policy", { ...settings.policy, [key]: event.target.value.split(",").map((value) => value.trim()).filter(Boolean) })} /></label>)}
    </div></details>
    <Button type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar configuración de ejecución"}</Button>
  </form>;
}

export function BotSkillsPanel({ bot, onSaved }: { bot: BotInfo; onSaved: () => void }) {
  const [skills, setSkills] = useState<{ id: string; name: string; description: string }[]>([]);
  const [selected, setSelected] = useState<string[]>(bot.skillIds ?? []);
  useEffect(() => { void api<{ skills: typeof skills }>("/api/skills").then((data) => setSkills(data.skills)).catch((error) => toast.error(String(error))); }, []);
  return <div className="grid gap-3"><p className="text-muted-fg text-sm">El Nexbot elige las skills relevantes entre las que le asignes. También puedes invocarlas con /nombre.</p>{skills.map((skill) => <label className="border-border flex items-start gap-3 rounded-xl border p-3" key={skill.id}><input className="mt-1" type="checkbox" checked={selected.includes(skill.id)} onChange={(event) => setSelected((old) => event.target.checked ? [...old, skill.id] : old.filter((id) => id !== skill.id))} /><span><span className="text-sm font-medium">{skill.name}</span><span className="text-muted-fg mt-1 block text-xs">{skill.description}</span></span></label>)}{!skills.length ? <Link href="/skills" className="text-sm underline">Crear o importar skills en la biblioteca</Link> : null}<Button onClick={() => void api(`/api/bots/${bot.id}`, { skillIds: selected }, "PATCH").then(() => { toast.success("Skills asignadas"); onSaved(); }).catch((error) => toast.error(String(error)))}>Guardar skills</Button></div>;
}

export function BotMemoryPanel({ botId }: { botId: string }) {
  const [memories, setMemories] = useState<{ key: string; value: string }[]>([]);
  const load = () => void api<{ memories: typeof memories }>(`/api/bots/${botId}/memory`).then((data) => setMemories(data.memories)).catch((error) => toast.error(String(error)));
  useEffect(load, [botId]);
  return <div className="grid gap-3"><p className="text-muted-fg text-sm">Recuerdos del ámbito configurado para este Nexbot.</p>{memories.length ? memories.map((memory) => <article className="border-border rounded-xl border p-3" key={memory.key}><p className="text-sm font-medium">{memory.key}</p><p className="text-muted-fg my-2 text-sm">{memory.value}</p><Button size="sm" variant="ghost" onClick={() => void api(`/api/bots/${botId}/memory`, { key: memory.key }, "DELETE").then(load).catch((error) => toast.error(String(error)))}>Olvidar</Button></article>) : <p className="text-muted-fg text-sm">No hay recuerdos guardados.</p>}</div>;
}
