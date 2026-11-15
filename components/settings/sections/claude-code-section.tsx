"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";

interface Settings {
  /** Quedaba guardado un token común de versiones anteriores: se borra al guardar. */
  legacyToken: boolean;
  enabled: boolean;
  maxConcurrency: number;
  timeoutS: number;
  status: { available: boolean; reason: string | null; cliReady: boolean };
}

const ENDPOINT = "/api/admin/instance/claude-code";

/**
 * Claude Code en la instancia. Cada usuario vincula su propia cuenta de Anthropic en
 * Suscripciones; aquí solo se activa y se limita. Solo superadmins; la API lo vuelve a comprobar.
 */
export function ClaudeCodeSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [concurrency, setConcurrency] = useState("2");
  const [timeoutS, setTimeoutS] = useState("300");
  const [busy, setBusy] = useState(false);

  function apply(data: Settings) {
    setSettings(data);
    setEnabled(data.enabled);
    setConcurrency(String(data.maxConcurrency));
    setTimeoutS(String(data.timeoutS));
  }

  useEffect(() => {
    fetch(ENDPOINT)
      .then(async (res) => {
        if (!res.ok) throw new Error("No se pudo cargar la configuración");
        apply((await res.json()) as Settings);
      })
      .catch((error: Error) => setLoadError(error.message));
  }, []);

  async function put(body: object): Promise<boolean> {
    setBusy(true);
    const res = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "No se pudo guardar");
      return false;
    }
    apply((await res.json()) as Settings);
    return true;
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const saved = await put({
      enabled,
      maxConcurrency: Number(concurrency),
      timeoutS: Number(timeoutS),
    });
    if (saved) toast.success("Guardado");
  }

  if (loadError) {
    return (
      <p role="alert" className="text-danger text-sm">
        {loadError}
      </p>
    );
  }
  if (!settings) return <Skeleton className="h-40 w-full rounded-xl" />;

  const control = "h-10 w-full rounded-lg sm:w-72";
  const { cliReady, reason } = settings.status;

  return (
    <>
      <SettingsSectionTitle>Claude Code</SettingsSectionTitle>
      <form onSubmit={save}>
        <SettingsGroup title="Estado">
          <SettingsRow
            label="CLI del servidor"
            description={
              cliReady
                ? "Cada usuario con permiso vincula su propia cuenta de Anthropic en Ajustes → Suscripciones. No hay una suscripción común."
                : (reason ?? "No disponible")
            }
          >
            <span className={cliReady ? "text-success text-[14px]" : "text-warning text-[14px]"}>
              {cliReady ? "Listo" : "No disponible"}
            </span>
          </SettingsRow>
          {settings.legacyToken ? (
            <SettingsRow
              label="Token común antiguo"
              description="Ya no se usa: la suscripción no se comparte entre usuarios. Se borrará al guardar."
            >
              <span className="text-warning text-[14px]">Pendiente de borrar</span>
            </SettingsRow>
          ) : null}
          <SettingsRow label="Activado" description="Si lo apagas, nadie podrá usarlo aunque tenga permiso.">
            <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Activar Claude Code" />
          </SettingsRow>
        </SettingsGroup>

        <SettingsGroup title="Límites">
          <SettingsRow
            label="Llamadas simultáneas"
            htmlFor="claude-code-concurrency"
            description="Por cuenta de Anthropic. Súbelo con cuidado: cada suscripción tiene límites de uso."
          >
            <Input
              id="claude-code-concurrency"
              type="number"
              min={1}
              max={20}
              required
              value={concurrency}
              onChange={(event) => setConcurrency(event.target.value)}
              className={control}
            />
          </SettingsRow>
          <SettingsRow label="Tiempo máximo por llamada (segundos)" htmlFor="claude-code-timeout">
            <Input
              id="claude-code-timeout"
              type="number"
              min={30}
              max={1800}
              required
              value={timeoutS}
              onChange={(event) => setTimeoutS(event.target.value)}
              className={control}
            />
          </SettingsRow>
        </SettingsGroup>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button type="submit" disabled={busy} className="rounded-full px-5">
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </>
  );
}
