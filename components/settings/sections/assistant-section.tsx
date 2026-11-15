"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";

type PromptKey = "core" | "ui" | "followups";

interface AssistantSettings {
  prompts: Record<PromptKey, string | null>;
  ui: { mode: "auto" | "request"; profile: "minimal" | "data" | "forms" | "lists" | "full" };
  generation: { temperature: number | null; maxTokens: number | null; reasoningEffort: "low" | "medium" | "high" | null };
  limits: { maxTurns: number; researchMaxTurns: number; contextTokens: number | null };
}

interface View {
  settings: AssistantSettings;
  defaults: Record<PromptKey, string> | null;
}

const ENDPOINT = "/api/admin/instance/assistant";
const PROVIDER = "provider";

const PROMPTS: { key: PromptKey; label: string; description: string }[] = [
  {
    key: "core",
    label: "Reglas generales",
    description: "Cómo trabaja el asistente: búsqueda, citas, tono. {name}, {role} y {today} se sustituyen al enviarlo.",
  },
  {
    key: "ui",
    label: "Interfaz generativa",
    description: "Cuándo debe (y cuándo no) responder con tarjetas, tablas o gráficos.",
  },
  {
    key: "followups",
    label: "Preguntas de seguimiento",
    description: "Cuándo proponer preguntas de seguimiento al final de la respuesta.",
  },
];

const PROFILES: { value: AssistantSettings["ui"]["profile"]; label: string }[] = [
  { value: "minimal", label: "Básico: tarjetas y texto" },
  { value: "data", label: "Datos: + tablas y gráficos" },
  { value: "lists", label: "Listas: + listas y secciones" },
  { value: "forms", label: "Formularios: + campos y botones" },
  { value: "full", label: "Completo: todos los componentes" },
];

const numberOrNull = (value: string): number | null => (value.trim() === "" ? null : Number(value));

/** Prompt del sistema y parámetros del modelo de toda la instancia. Solo superadmins; la API lo vuelve a comprobar. */
export function AssistantSection() {
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssistantSettings | null>(null);
  const [prompts, setPrompts] = useState<Record<PromptKey, string>>({ core: "", ui: "", followups: "" });
  const [busy, setBusy] = useState(false);

  function apply(data: View) {
    setView(data);
    setDraft(data.settings);
    setPrompts({
      core: data.settings.prompts.core ?? data.defaults?.core ?? "",
      ui: data.settings.prompts.ui ?? data.defaults?.ui ?? "",
      followups: data.settings.prompts.followups ?? data.defaults?.followups ?? "",
    });
  }

  useEffect(() => {
    fetch(ENDPOINT)
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo cargar la configuración");
        apply((await res.json()) as View);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  if (loadError) {
    return (
      <p role="alert" className="text-danger text-sm">
        {loadError}
      </p>
    );
  }
  if (!view || !draft) return <Skeleton className="h-40 w-full rounded-xl" />;

  const defaults = view.defaults;

  /** Un texto igual al de por defecto se guarda como null: así hereda futuras mejoras. */
  function promptValue(key: PromptKey): string | null {
    const text = prompts[key];
    if (!text.trim()) return null;
    if (defaults && text.trim() === defaults[key].trim()) return null;
    return text;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    const body: AssistantSettings = {
      ...draft,
      prompts: { core: promptValue("core"), ui: promptValue("ui"), followups: promptValue("followups") },
    };
    const res = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "No se pudo guardar");
      return;
    }
    apply((await res.json()) as View);
    toast.success("Guardado. Se aplica a los próximos mensajes.");
  }

  const control = "h-10 w-full rounded-lg sm:w-72";
  const set = <K extends keyof AssistantSettings>(key: K, value: Partial<AssistantSettings[K]>) =>
    setDraft((prev) => (prev ? { ...prev, [key]: { ...prev[key], ...value } } : prev));

  return (
    <>
      <SettingsSectionTitle>Asistente</SettingsSectionTitle>
      <form onSubmit={save}>
        <SettingsGroup title="Interfaz generativa">
          <SettingsRow
            label="Cuándo se ofrece"
            description={
              draft.ui.mode === "auto"
                ? "En todos los mensajes. El modelo decide si una tabla o un gráfico ayuda, según las reglas de abajo."
                : "Solo cuando la persona activa «UI» en el compositor, en el foco de finanzas o noticias y en Research."
            }
          >
            <Select value={draft.ui.mode} onValueChange={(value) => set("ui", { mode: value as "auto" | "request" })}>
              <SelectTrigger className={control} aria-label="Cuándo se ofrece la interfaz generativa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Siempre (decide el modelo)</SelectItem>
                <SelectItem value="request">Solo si se pide</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
          <SettingsRow
            label="Componentes disponibles"
            description="Qué se le enseña al modelo en cada mensaje. Más componentes cuestan más tokens (Datos ≈ 4-5k; Completo ≈ 13k)."
          >
            <Select
              value={draft.ui.profile}
              onValueChange={(value) => set("ui", { profile: value as AssistantSettings["ui"]["profile"] })}
              disabled={draft.ui.mode !== "auto"}
            >
              <SelectTrigger className={control} aria-label="Componentes de la interfaz generativa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROFILES.map((profile) => (
                  <SelectItem key={profile.value} value={profile.value}>
                    {profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Prompt del sistema">
          {!defaults ? (
            <p className="text-warning px-4 py-3 text-[13px]">
              El motor de agentes no responde, así que no se pueden mostrar los textos por defecto. Un campo vacío usa
              el texto por defecto.
            </p>
          ) : null}
          {PROMPTS.map(({ key, label, description }) => {
            const custom = promptValue(key) !== null;
            return (
              <div key={key} className="px-4 py-4">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <label htmlFor={`prompt-${key}`} className="block text-[15px] font-medium">
                      {label}
                      {custom ? <span className="text-brand ml-2 text-[12px] font-normal">Personalizado</span> : null}
                    </label>
                    <p className="text-muted-fg mt-0.5 text-[13px]">{description}</p>
                  </div>
                  {custom ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="shrink-0 rounded-full"
                      onClick={() => setPrompts((prev) => ({ ...prev, [key]: defaults?.[key] ?? "" }))}
                    >
                      Restablecer
                    </Button>
                  ) : null}
                </div>
                <Textarea
                  id={`prompt-${key}`}
                  value={prompts[key]}
                  onChange={(event) => setPrompts((prev) => ({ ...prev, [key]: event.target.value }))}
                  rows={key === "followups" ? 3 : 12}
                  spellCheck={false}
                  className="font-mono text-[12.5px] leading-relaxed"
                />
              </div>
            );
          })}
        </SettingsGroup>

        <SettingsGroup title="Modelo">
          <SettingsRow
            label="Temperatura"
            htmlFor="assistant-temperature"
            description="0 = más preciso y repetible; 1 o más = más creativo. Vacío: la del proveedor."
          >
            <Input
              id="assistant-temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              placeholder={PROVIDER}
              value={draft.generation.temperature ?? ""}
              onChange={(event) => set("generation", { temperature: numberOrNull(event.target.value) })}
              className={control}
            />
          </SettingsRow>
          <SettingsRow
            label="Máximo de tokens por respuesta"
            htmlFor="assistant-max-tokens"
            description="Límite de cada llamada al modelo. Vacío: el del proveedor."
          >
            <Input
              id="assistant-max-tokens"
              type="number"
              min={256}
              max={128000}
              step={256}
              placeholder={PROVIDER}
              value={draft.generation.maxTokens ?? ""}
              onChange={(event) => set("generation", { maxTokens: numberOrNull(event.target.value) })}
              className={control}
            />
          </SettingsRow>
          <SettingsRow
            label="Esfuerzo de razonamiento"
            description="Solo en modelos que razonan y lo admiten. Más esfuerzo: mejores respuestas, más lentas y caras."
          >
            <Select
              value={draft.generation.reasoningEffort ?? PROVIDER}
              onValueChange={(value) =>
                set("generation", {
                  reasoningEffort: value === PROVIDER ? null : (value as "low" | "medium" | "high"),
                })
              }
            >
              <SelectTrigger className={control} aria-label="Esfuerzo de razonamiento">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PROVIDER}>El del proveedor</SelectItem>
                <SelectItem value="low">Bajo</SelectItem>
                <SelectItem value="medium">Medio</SelectItem>
                <SelectItem value="high">Alto</SelectItem>
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Límites por mensaje">
          <SettingsRow
            label="Pasos máximos"
            htmlFor="assistant-max-turns"
            description="Cada búsqueda, lectura o llamada a herramienta cuenta como un paso."
          >
            <Input
              id="assistant-max-turns"
              type="number"
              min={4}
              max={80}
              required
              value={draft.limits.maxTurns}
              onChange={(event) => set("limits", { maxTurns: Number(event.target.value) })}
              className={control}
            />
          </SettingsRow>
          <SettingsRow label="Pasos máximos en Research" htmlFor="assistant-research-turns">
            <Input
              id="assistant-research-turns"
              type="number"
              min={8}
              max={120}
              required
              value={draft.limits.researchMaxTurns}
              onChange={(event) => set("limits", { researchMaxTurns: Number(event.target.value) })}
              className={control}
            />
          </SettingsRow>
          <SettingsRow
            label="Contexto máximo (tokens)"
            htmlFor="assistant-context"
            description="Tope de cada llamada al modelo. No lo pongas por encima de lo que admite el modelo. Vacío: el del servidor."
          >
            <Input
              id="assistant-context"
              type="number"
              min={8000}
              max={1000000}
              step={1000}
              placeholder="NEXUS_AGENT_CONTEXT_TOKENS"
              value={draft.limits.contextTokens ?? ""}
              onChange={(event) => set("limits", { contextTokens: numberOrNull(event.target.value) })}
              className={control}
            />
          </SettingsRow>
        </SettingsGroup>

        <p className="text-muted-fg mb-4 text-[13px]">
          Se aplica a toda la instancia y a todos los modelos. Las instrucciones propias de cada agente se añaden
          después de estas.
        </p>
        <div className="flex justify-end">
          <Button type="submit" className="rounded-full" disabled={busy}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </>
  );
}
