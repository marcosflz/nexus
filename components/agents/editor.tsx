"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { cloneElement, isValidElement, useCallback, useEffect, useId, useState } from "react";
import { Loader2, Plus, Save, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { Page } from "@/components/shell/page";
import { useShell } from "@/components/shell/shell-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_TOOL_IDS, type AgentSpec } from "@/lib/agents/spec";
import { PROVIDERS } from "@/lib/providers";
import { KnowledgePanel } from "./knowledge-panel";
import { TriggersPanel } from "./triggers-panel";

interface Meta {
  description: string;
  visibility: "private" | "unlisted" | "public";
  status: "active" | "paused";
}

interface Connector {
  id: string;
  name: string;
  url: string;
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "Buscar en la web",
  web_fetch: "Leer páginas",
  present_openui: "Mostrar interfaces (tablas, gráficos…)",
  prompt_openui: "Pedirte datos con formularios",
  suggest_followups: "Proponer preguntas de seguimiento",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  // El control hereda el id para que la etiqueta quede asociada (lectores de pantalla, clic en la etiqueta).
  const control = isValidElement<{ id?: string }>(children)
    ? cloneElement(children, { id: children.props.id ?? id })
    : children;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

export function AgentEditor({
  agentId,
  initialSpec,
  initialMeta,
  canEdit,
}: {
  agentId: string | null;
  initialSpec: AgentSpec;
  initialMeta: Meta;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { openSettings } = useShell();
  const isNew = agentId === null;
  const [spec, setSpec] = useState<AgentSpec>(isNew ? { ...initialSpec, name: "" } : initialSpec);
  const [meta, setMeta] = useState<Meta>(initialMeta);
  const [saving, setSaving] = useState(false);
  const [description, setDescription] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [versions, setVersions] = useState<{ id: string; version: number; createdAt: string }[]>([]);
  const [computerAvailable, setComputerAvailable] = useState(false);
  const [humanControl, setHumanControl] = useState(false);

  const patch = useCallback((changes: Partial<AgentSpec>) => setSpec((prev) => ({ ...prev, ...changes })), []);

  useEffect(() => {
    fetch("/api/connectors")
      .then((res) => (res.ok ? res.json() : { connectors: [] }))
      .then((data: { connectors: Connector[] }) => setConnectors(data.connectors))
      .catch(() => {});
    fetch("/api/capabilities")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { computer?: boolean } | null) => setComputerAvailable(Boolean(data?.computer)))
      .catch(() => {});
    if (agentId) {
      fetch(`/api/agents/${agentId}/computer`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { humanControl?: boolean } | null) => setHumanControl(Boolean(data?.humanControl)))
        .catch(() => {});
      fetch(`/api/agents/${agentId}/versions`)
        .then((res) => (res.ok ? res.json() : { versions: [] }))
        .then((data) => setVersions(data.versions))
        .catch(() => {});
    }
  }, [agentId]);

  async function draft() {
    setDrafting(true);
    try {
      const res = await fetch("/api/agents/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const data = (await res.json().catch(() => ({}))) as { spec?: AgentSpec; error?: string };
      if (!res.ok || !data.spec) throw new Error(data.error ?? "No se pudo generar el borrador");
      setSpec((prev) => ({ ...prev, ...data.spec, connectors: prev.connectors }));
      toast.success("Borrador aplicado: revísalo y ajusta lo que quieras antes de guardar");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo generar el borrador");
    } finally {
      setDrafting(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(isNew ? "/api/agents" : `/api/agents/${agentId}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spec, ...meta }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        agent?: { id: string };
        error?: string;
        issues?: string[];
      };
      if (!res.ok) throw new Error([data.error, ...(data.issues ?? [])].filter(Boolean).join(" · "));
      toast.success(isNew ? "Agente creado" : "Nueva versión guardada");
      if (isNew && data.agent) router.replace(`/agents/${data.agent.id}`);
      else router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  const toggleTool = (tool: string, on: boolean) =>
    patch({ tools: on ? [...new Set([...spec.tools, tool])] : spec.tools.filter((item) => item !== tool) });
  const toggleConnector = (id: string, on: boolean) =>
    patch({
      connectors: on
        ? [...spec.connectors, { connectorId: id }]
        : spec.connectors.filter((item) => item.connectorId !== id),
    });
  const readOnly = !canEdit;

  async function toggleControl(control: boolean) {
    if (!agentId) return;
    const res = await fetch(`/api/agents/${agentId}/computer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ control }),
    });
    if (!res.ok) return toast.error("No se pudo cambiar el control");
    setHumanControl(control);
    toast.success(control ? "Tienes el control: el agente no usará su navegador" : "El agente recupera su navegador");
  }

  return (
    <Page
      title={isNew ? "Nuevo agente" : spec.name || "Agente"}
      back={{ href: "/agents", label: "Agentes" }}
      actions={
        canEdit ? (
          <Button onClick={save} disabled={saving || !spec.name.trim()} className="rounded-full">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {isNew ? "Crear agente" : "Guardar nueva versión"}
          </Button>
        ) : (
          <Badge variant="secondary" className="rounded-full">Solo lectura</Badge>
        )
      }
    >

      {isNew ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" /> Describe tu agente
            </CardTitle>
            <CardDescription>
              Cuéntalo con tus palabras y se rellenará un borrador que puedes revisar. Nunca activa por su cuenta
              conectores, navegador ni herramientas con efectos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Un asesor que cada mañana resume las noticias del sector fintech en español y destaca lo que afecta a pymes…"
              rows={3}
            />
            <Button variant="secondary" onClick={draft} disabled={drafting || description.trim().length < 5}>
              {drafting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generar borrador
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="perfil">
        <TabsList className="bg-surface-2 mb-6 h-auto flex-wrap justify-start gap-1 rounded-full p-1">
          <TabsTrigger value="perfil" className="rounded-full px-3.5">Perfil</TabsTrigger>
          <TabsTrigger value="instrucciones" className="rounded-full px-3.5">Instrucciones</TabsTrigger>
          <TabsTrigger value="herramientas" className="rounded-full px-3.5">Herramientas</TabsTrigger>
          {!isNew ? <TabsTrigger value="conocimiento" className="rounded-full px-3.5">Conocimiento</TabsTrigger> : null}
          <TabsTrigger value="modelo" className="rounded-full px-3.5">Modelo y límites</TabsTrigger>
          {!isNew ? <TabsTrigger value="automatizacion" className="rounded-full px-3.5">Automatización</TabsTrigger> : null}
          {!isNew ? <TabsTrigger value="versiones" className="rounded-full px-3.5">Versiones</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="perfil" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_6rem]">
            <Field label="Nombre">
              <Input value={spec.name} maxLength={80} disabled={readOnly} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Avatar" hint="Un emoji">
              <Input value={spec.avatar} maxLength={8} disabled={readOnly} onChange={(e) => patch({ avatar: e.target.value })} />
            </Field>
          </div>
          <Field label="Rol" hint="Una línea que resume qué hace">
            <Input value={spec.role} maxLength={200} disabled={readOnly} onChange={(e) => patch({ role: e.target.value })} />
          </Field>
          <Field label="Descripción" hint="Se muestra en la galería">
            <Textarea value={meta.description} rows={2} maxLength={500} disabled={readOnly} onChange={(e) => setMeta({ ...meta, description: e.target.value })} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Visibilidad" hint="Los públicos aparecen en la galería; «con enlace» solo lo usa quien tenga el enlace. Ojo: quien use el agente podrá consultar su conocimiento (no descargar los ficheros).">
              <Select value={meta.visibility} disabled={readOnly} onValueChange={(v) => setMeta({ ...meta, visibility: v as Meta["visibility"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Privado</SelectItem>
                  <SelectItem value="unlisted">Con enlace</SelectItem>
                  <SelectItem value="public">Público</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Estado" hint="En pausa no ejecuta disparadores ni tareas programadas.">
              <Select value={meta.status} disabled={readOnly} onValueChange={(v) => setMeta({ ...meta, status: v as Meta["status"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="paused">En pausa</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field label="Preguntas de arranque" hint="Hasta 6; aparecen en un chat nuevo con este agente.">
            <div className="space-y-2">
              {spec.starters.map((starter, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={starter}
                    maxLength={200}
                    disabled={readOnly}
                    onChange={(e) => patch({ starters: spec.starters.map((s, i) => (i === index ? e.target.value : s)) })}
                  />
                  {!readOnly ? (
                    <Button variant="ghost" size="icon" aria-label="Quitar" onClick={() => patch({ starters: spec.starters.filter((_, i) => i !== index) })}>
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ))}
              {!readOnly && spec.starters.length < 6 ? (
                <Button variant="outline" size="sm" onClick={() => patch({ starters: [...spec.starters, ""] })}>
                  <Plus className="size-4" /> Añadir
                </Button>
              ) : null}
            </div>
          </Field>
        </TabsContent>

        <TabsContent value="instrucciones" className="space-y-3">
          <Field label="Instrucciones" hint="Cómo debe comportarse: objetivo, tono, formato, qué hacer y qué no. Hasta 8000 caracteres.">
            <Textarea value={spec.instructions} rows={14} maxLength={8000} disabled={readOnly} onChange={(e) => patch({ instructions: e.target.value })} />
          </Field>
        </TabsContent>

        <TabsContent value="herramientas" className="space-y-5">
          <div className="space-y-2">
            {AGENT_TOOL_IDS.map((tool) => (
              <label key={tool} className="flex items-center justify-between gap-4 border-border bg-surface rounded-xl border p-4 text-sm">
                <span>{TOOL_LABELS[tool]}</span>
                <Switch checked={spec.tools.includes(tool)} disabled={readOnly} onCheckedChange={(on) => toggleTool(tool, on)} />
              </label>
            ))}
          </div>
          <Field label="Interfaz generativa" hint="Con «Siempre» el agente prefiere responder con interfaces.">
            <Select value={spec.ui.openui} disabled={readOnly} onValueChange={(v) => patch({ ui: { ...spec.ui, openui: v as AgentSpec["ui"]["openui"] } })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Desactivada</SelectItem>
                <SelectItem value="auto">Cuando aporte</SelectItem>
                <SelectItem value="always">Siempre</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <label className="flex items-center justify-between gap-4 border-border bg-surface rounded-xl border p-4 text-sm">
            <span>
              Memoria
              <span className="text-muted-foreground block text-xs">Recuerda datos duraderos entre conversaciones.</span>
            </span>
            <Switch checked={spec.memory.enabled} disabled={readOnly} onCheckedChange={(on) => patch({ memory: { ...spec.memory, enabled: on } })} />
          </label>
          {computerAvailable ? (
            <div className="space-y-2 border-border bg-surface rounded-xl border p-4 text-sm">
              <label className="flex items-center justify-between gap-4">
                <span>
                  Ordenador (navegador propio)
                  <span className="text-muted-foreground block text-xs">
                    Un navegador aislado y persistente solo para este agente (con sus cookies y ficheros). Leer es libre;
                    pulsar, escribir o enviar formularios pide tu aprobación.
                  </span>
                </span>
                <Switch
                  checked={spec.computer.enabled}
                  disabled={readOnly}
                  onCheckedChange={(on) => patch({ computer: { enabled: on } })}
                />
              </label>
              {spec.computer.enabled && agentId && canEdit ? (
                <div className="flex items-center justify-between gap-4 border-t pt-2">
                  <span className="text-muted-foreground text-xs">
                    {humanControl ? "Tienes el control: el agente no puede usar su navegador." : "El agente conduce su navegador."}
                  </span>
                  <Button size="sm" variant={humanControl ? "default" : "outline"} onClick={() => toggleControl(!humanControl)}>
                    {humanControl ? "Devolver el control" : "Tomar el control"}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="space-y-2">
            <Label>Conectores MCP</Label>
            {connectors.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                No tienes conectores. Añádelos en <button type="button" className="underline" onClick={() => openSettings("connectors")}>Ajustes</button>.
              </p>
            ) : (
              connectors.map((connector) => (
                <label key={connector.id} className="flex items-center justify-between gap-4 border-border bg-surface rounded-xl border p-4 text-sm">
                  <span>
                    {connector.name}
                    <span className="text-muted-foreground block truncate text-xs">{connector.url}</span>
                  </span>
                  <Switch
                    checked={spec.connectors.some((item) => item.connectorId === connector.id)}
                    disabled={readOnly}
                    onCheckedChange={(on) => toggleConnector(connector.id, on)}
                  />
                </label>
              ))
            )}
            <p className="text-muted-foreground text-xs">
              Las acciones de un conector que cambian algo piden tu aprobación cuando el agente trabaja por su cuenta.
            </p>
          </div>
        </TabsContent>

        {!isNew && agentId ? (
          <TabsContent value="conocimiento">
            <KnowledgePanel
              agentId={agentId}
              enabled={spec.knowledge.enabled}
              topK={spec.knowledge.topK}
              canEdit={canEdit}
              onChange={(knowledge) => patch({ knowledge })}
            />
          </TabsContent>
        ) : null}

        <TabsContent value="modelo" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Proveedor" hint="Usa la API key que ya guardaste para ese proveedor.">
              <Select
                value={spec.model.provider ?? "__default"}
                disabled={readOnly}
                onValueChange={(v) => patch({ model: { ...spec.model, provider: v === "__default" ? undefined : v } })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default">El predeterminado de mi cuenta</SelectItem>
                  {PROVIDERS.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>{provider.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Modelo" hint="Vacío = el de la cuenta.">
              <Input value={spec.model.model ?? ""} disabled={readOnly} onChange={(e) => patch({ model: { ...spec.model, model: e.target.value || undefined } })} />
            </Field>
          </div>
          <h3 className="pt-2 text-sm font-medium">Límites (0 = sin límite)</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["maxRunsPerDay", "Ejecuciones al día"],
                ["maxTokensPerRun", "Tokens por ejecución"],
                ["maxTokensPerDay", "Tokens al día"],
                ["maxToolCalls", "Pasos por ejecución"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  type="number"
                  min={0}
                  value={spec.budgets[key]}
                  disabled={readOnly}
                  onChange={(e) => patch({ budgets: { ...spec.budgets, [key]: Math.max(0, Number(e.target.value) || 0) } })}
                />
              </Field>
            ))}
          </div>
        </TabsContent>

        {!isNew && agentId ? (
          <TabsContent value="automatizacion">
            <TriggersPanel agentId={agentId} canEdit={canEdit} />
          </TabsContent>
        ) : null}

        {!isNew ? (
          <TabsContent value="versiones" className="space-y-2">
            <p className="text-muted-foreground text-sm">
              Cada cambio crea una versión nueva. Las ejecuciones en curso o programadas conservan la versión con la que empezaron.
            </p>
            {versions.map((version) => (
              <div key={version.id} className="flex items-center justify-between border-border bg-surface rounded-xl border p-4 text-sm">
                <span>Versión {version.version}</span>
                <span className="text-muted-foreground">{new Date(version.createdAt).toLocaleString("es")}</span>
              </div>
            ))}
          </TabsContent>
        ) : null}
      </Tabs>
    </Page>
  );
}
