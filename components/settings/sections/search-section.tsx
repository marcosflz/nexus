"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  searchProvider,
  type SearchProviderId,
  type SearchProviderView,
  type SearchSettingsView,
} from "@/lib/search/providers";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";

const ENDPOINT = "/api/admin/instance/search";

interface Draft extends SearchProviderView {
  apiKey: string;
  clearKey: boolean;
  urlInput: string;
}

interface TestResult {
  ok: boolean;
  results: number;
  ms: number;
  error: string | null;
  degraded?: string[];
}

const toDraft = (provider: SearchProviderView): Draft => ({
  ...provider,
  apiKey: "",
  clearKey: false,
  urlInput: provider.baseUrl ?? "",
});

function ProviderCard({
  draft,
  position,
  total,
  result,
  testing,
  onChange,
  onMove,
  onTest,
}: {
  draft: Draft;
  position: number;
  total: number;
  result: TestResult | undefined;
  testing: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onMove: (delta: number) => void;
  onTest: () => void;
}) {
  const meta = searchProvider(draft.id);
  const keyPresent = draft.hasKey && !draft.clearKey;
  return (
    <div className="grid gap-3 px-4 py-4">
      <div className="flex items-start gap-3">
        <div className="flex flex-col">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Subir ${meta.label}`}
            disabled={position === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Bajar ${meta.label}`}
            disabled={position === total - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium">{meta.label}</span>
            {draft.enabled ? (
              <Badge variant="outline" className="rounded-full">
                Prioridad {position + 1}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-fg mt-0.5 text-[13px]">
            {meta.description}{" "}
            <a href={meta.docsUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              Documentación
            </a>
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(enabled) => onChange({ enabled })}
          aria-label={`Activar ${meta.label}`}
        />
      </div>

      {meta.needsKey ? (
        <div className="grid gap-1.5 pl-9">
          <Label htmlFor={`key-${draft.id}`} className="text-[13px]">
            Clave de API
          </Label>
          <div className="flex gap-2">
            <Input
              id={`key-${draft.id}`}
              type="password"
              autoComplete="off"
              value={draft.apiKey}
              onChange={(event) => onChange({ apiKey: event.target.value, clearKey: false })}
              placeholder={keyPresent ? "•••••••• (guardada; escribe para reemplazar)" : "Pega aquí la clave"}
              className="h-9 rounded-lg"
            />
            {keyPresent ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange({ clearKey: true, apiKey: "", enabled: false })}
              >
                Quitar
              </Button>
            ) : null}
          </div>
          {draft.keyUnreadable ? (
            <p className="text-warning text-[12px]">
              La clave guardada no se puede descifrar (¿cambió APP_ENCRYPTION_KEY?). Introduce una nueva.
            </p>
          ) : null}
        </div>
      ) : null}

      {meta.hasBaseUrl ? (
        <div className="grid gap-1.5 pl-9">
          <Label htmlFor={`url-${draft.id}`} className="text-[13px]">
            URL del servicio
          </Label>
          <Input
            id={`url-${draft.id}`}
            value={draft.urlInput}
            onChange={(event) => onChange({ urlInput: event.target.value })}
            placeholder="La del servidor (SEARXNG_URL)"
            className="h-9 rounded-lg"
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3 pl-9">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={testing || (meta.needsKey && !keyPresent && !draft.apiKey.trim())}
          onClick={onTest}
        >
          {testing ? "Probando…" : "Probar"}
        </Button>
        {result ? (
          <p role="status" className={result.ok ? "text-success text-[13px]" : "text-danger text-[13px]"}>
            {result.ok ? `${result.results} resultados en ${result.ms} ms` : (result.error ?? "La prueba ha fallado")}
          </p>
        ) : null}
        {result?.ok && result.degraded?.length ? (
          <p className="text-warning basis-full text-[13px]">
            No responden: {result.degraded.join(", ")}. Los resultados pueden llegar incompletos o sin extracto; añade un
            motor por API (LangSearch o Brave) como respaldo.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Motores de búsqueda de la instancia. Solo admins; la API lo vuelve a comprobar. */
export function SearchSection() {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [minResults, setMinResults] = useState("3");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<SearchProviderId | null>(null);
  const [results, setResults] = useState<Partial<Record<SearchProviderId, TestResult>>>({});

  function apply(data: SearchSettingsView) {
    setDrafts(data.providers.map(toDraft));
    setMinResults(String(data.minResults));
  }

  useEffect(() => {
    fetch(ENDPOINT)
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo cargar la configuración");
        apply((await res.json()) as SearchSettingsView);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  const patch = (id: SearchProviderId, change: Partial<Draft>) =>
    setDrafts((prev) => prev?.map((draft) => (draft.id === id ? { ...draft, ...change } : draft)) ?? prev);

  function move(index: number, delta: number) {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      [next[index], next[index + delta]] = [next[index + delta], next[index]];
      return next;
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!drafts) return;
    setBusy(true);
    const res = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        minResults: Number(minResults),
        providers: drafts.map((draft) => ({
          id: draft.id,
          enabled: draft.enabled,
          ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
          ...(draft.clearKey ? { clearKey: true } : {}),
          ...(searchProvider(draft.id).hasBaseUrl ? { baseUrl: draft.urlInput.trim() || null } : {}),
        })),
      }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "No se pudo guardar");
      return;
    }
    apply((await res.json()) as SearchSettingsView);
    toast.success("Guardado");
  }

  async function test(draft: Draft) {
    setTesting(draft.id);
    const res = await fetch(`${ENDPOINT}/test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: draft.id,
        ...(draft.apiKey.trim() ? { apiKey: draft.apiKey.trim() } : {}),
        ...(searchProvider(draft.id).hasBaseUrl ? { baseUrl: draft.urlInput.trim() || null } : {}),
      }),
    });
    setTesting(null);
    const data = (await res.json().catch(() => null)) as TestResult | null;
    setResults((prev) => ({
      ...prev,
      [draft.id]: data ?? { ok: false, results: 0, ms: 0, error: "La prueba ha fallado" },
    }));
  }

  if (loadError) {
    return (
      <p role="alert" className="text-danger text-sm">
        {loadError}
      </p>
    );
  }
  if (!drafts) return <Skeleton className="h-40 w-full rounded-xl" />;

  const noneEnabled = drafts.every((draft) => !draft.enabled);

  return (
    <>
      <SettingsSectionTitle>Búsqueda web</SettingsSectionTitle>
      <form onSubmit={save}>
        <SettingsGroup title="Motores">
          {drafts.map((draft, index) => (
            <ProviderCard
              key={draft.id}
              draft={draft}
              position={index}
              total={drafts.length}
              result={results[draft.id]}
              testing={testing === draft.id}
              onChange={(change) => patch(draft.id, change)}
              onMove={(delta) => move(index, delta)}
              onTest={() => void test(draft)}
            />
          ))}
        </SettingsGroup>

        <SettingsGroup title="Respaldo">
          <SettingsRow
            label="Resultados mínimos"
            htmlFor="search-min-results"
            description="Con menos resultados se prueba también el siguiente motor activo, que puede tener coste."
          >
            <Input
              id="search-min-results"
              type="number"
              min={1}
              max={20}
              required
              value={minResults}
              onChange={(event) => setMinResults(event.target.value)}
              className="h-10 w-full rounded-lg sm:w-32"
            />
          </SettingsRow>
        </SettingsGroup>

        {noneEnabled ? (
          <p role="status" className="text-warning mb-4 text-sm">
            Sin ningún motor activo, los agentes no podrán buscar en la web.
          </p>
        ) : null}
        <div className="flex justify-end">
          <Button type="submit" disabled={busy} className="rounded-full px-5">
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </>
  );
}
