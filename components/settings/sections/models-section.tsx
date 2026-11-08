"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";

interface SavedCredential {
  provider: string;
  model: string;
  baseUrl: string | null;
  hasKey: boolean;
  isDefault: boolean;
}

interface ProviderOption {
  id: string;
  label: string;
  needsKey: boolean;
  defaultModel: string;
  /** El proveedor expone un endpoint de listado de modelos. */
  canListModels: boolean;
  /** Modelos fijos para elegir en un desplegable. */
  modelOptions: string[] | null;
  /** Usa la suscripción del servidor: no hay clave ni URL que configurar. */
  serverManaged: boolean;
  /** Motivo por el que ahora mismo no se puede usar. */
  unavailable: string | null;
}

export function ModelsSection() {
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [provider, setProvider] = useState("openrouter");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Proveedor al que pertenece la clave guardada. */
  const [savedProvider, setSavedProvider] = useState<string | null>(null);
  /** Lo ya configurado por proveedor, para recordar clave y modelo al cambiar de uno a otro. */
  const [saved, setSaved] = useState<SavedCredential[]>([]);

  const [models, setModels] = useState<string[]>([]);
  const [listing, setListing] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("error"))))
      .then(
        (data: {
          providers: ProviderOption[];
          credential: {
            provider: string;
            model: string;
            baseUrl: string | null;
            hasKey: boolean;
          } | null;
          saved?: SavedCredential[];
        }) => {
          setProviders(data.providers ?? []);
          setSaved(data.saved ?? []);
          if (data.credential) {
            setProvider(data.credential.provider);
            setModel(data.credential.model);
            setBaseUrl(data.credential.baseUrl ?? "");
            setHasKey(data.credential.hasKey);
            setSavedProvider(data.credential.hasKey ? data.credential.provider : null);
          } else if (data.providers?.[0]) {
            setModel(data.providers[0].defaultModel);
          }
        },
      )
      .catch(() => setError("No se pudo cargar la configuración"));
  }, []);

  const current = providers.find((p) => p.id === provider);

  /** Pide la lista de modelos. Sin clave usa la guardada, si es de ese proveedor. */
  const loadModels = useCallback(async (providerId: string, key: string) => {
    setListing(true);
    setListError(null);
    try {
      const res = await fetch("/api/settings/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, apiKey: key.trim() || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        models?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "No se pudieron cargar los modelos");

      const list = data.models ?? [];
      setModels(list);
      // Si no había modelo elegido, se preselecciona el primero.
      const first = list[0];
      if (first) setModel((prev) => prev || first);
      return list;
    } catch (listFailure) {
      setModels([]);
      setListError(listFailure instanceof Error ? listFailure.message : "Error al listar");
      return [];
    } finally {
      setListing(false);
    }
  }, []);

  // Al cambiar de proveedor, la lista anterior ya no vale.
  useEffect(() => {
    setModels([]);
    setListError(null);
    if (savedProvider === provider && hasKey) void loadModels(provider, "");
  }, [provider, savedProvider, hasKey, loadModels]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    setError(null);

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model,
        apiKey: apiKey.trim() ? apiKey.trim() : undefined,
        baseUrl: baseUrl.trim(),
      }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };

    if (res.ok) {
      setStatus("Guardado");
      const typedKey = apiKey.trim();
      setApiKey("");
      const nowHasKey = hasKey || typedKey.length > 0;
      setHasKey(nowHasKey);
      setSavedProvider(provider);
      setSaved((prev) => [
        { provider, model, baseUrl: baseUrl.trim() || null, hasKey: nowHasKey, isDefault: true },
        ...prev.filter((item) => item.provider !== provider).map((item) => ({ ...item, isDefault: false })),
      ]);
      if (current?.canListModels && nowHasKey) void loadModels(provider, "");
    } else {
      setError(data.error ?? "No se pudo guardar");
    }
    setBusy(false);
  }

  const listed = current?.modelOptions ?? models;
  const modelIsListed = listed.includes(model);
  const serverManaged = current?.serverManaged ?? false;
  const control = "h-10 w-full rounded-lg sm:w-72";

  return (
    <>
      <SettingsSectionTitle>Modelos y claves</SettingsSectionTitle>
      <form onSubmit={save}>
        <SettingsGroup title="Proveedor">
          <SettingsRow label="Proveedor">
            <Select
              value={provider}
              onValueChange={(next) => {
                setProvider(next);
                const info = providers.find((p) => p.id === next);
                // Si ese proveedor ya estaba configurado se recuerda su modelo y su clave.
                const remembered = saved.find((item) => item.provider === next);
                setModel(remembered?.model ?? info?.defaultModel ?? "");
                setBaseUrl(remembered?.baseUrl ?? "");
                setHasKey(remembered?.hasKey ?? false);
                setSavedProvider(remembered?.hasKey ? next : null);
                setApiKey("");
              }}
            >
              <SelectTrigger className={control} aria-label="Proveedor">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-80">
                {providers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                    {saved.some((item) => item.provider === p.id && (item.hasKey || p.serverManaged)) ? " ✓" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingsRow>

          {serverManaged ? (
            <SettingsRow
              label="Credencial"
              description={
                current?.unavailable ?? "Usa la suscripción configurada en el servidor; no necesitas clave propia."
              }
            >
              <span className={current?.unavailable ? "text-warning text-[14px]" : "text-success text-[14px]"}>
                {current?.unavailable ? "No disponible" : "Lista"}
              </span>
            </SettingsRow>
          ) : (
            <SettingsRow
              label={`API key${current && !current.needsKey ? " (opcional)" : ""}`}
              htmlFor="api-key"
              description="Se cifra en el servidor y solo se usa para tus consultas."
            >
              <Input
                id="api-key"
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                onBlur={() => {
                  // Al pegar la clave se listan los modelos solos.
                  if (current?.canListModels && apiKey.trim().length >= 8) {
                    void loadModels(provider, apiKey);
                  }
                }}
                placeholder={hasKey ? "•••••••• (guardada; escribe para reemplazar)" : "Tu API key"}
                className={control}
              />
            </SettingsRow>
          )}

          <SettingsRow
            label="Modelo"
            description={
              serverManaged
                ? "«default» usa el modelo predeterminado de tu suscripción."
                : models.length > 0
                  ? `${models.length} modelos disponibles en ${current?.label}.`
                  : undefined
            }
          >
            <div className="flex flex-col items-start gap-1 sm:items-end">
              {listed.length > 0 ? (
                <Select value={model || undefined} onValueChange={setModel}>
                  <SelectTrigger className={control} aria-label="Modelo">
                    <SelectValue placeholder="Elige un modelo…" />
                  </SelectTrigger>
                  <SelectContent className="max-h-80">
                    {model && !modelIsListed ? <SelectItem value={model}>{model} (actual)</SelectItem> : null}
                    {listed.map((id) => (
                      <SelectItem key={id} value={id}>
                        {id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder="p. ej. anthropic/claude-sonnet-4.6"
                  aria-label="Modelo"
                  className={control}
                />
              )}
              {current?.canListModels ? (
                <Button
                  type="button"
                  variant="link"
                  size="xs"
                  onClick={() => void loadModels(provider, apiKey)}
                  disabled={listing}
                  className="h-auto p-0"
                >
                  {listing ? "Consultando…" : models.length > 0 ? "Recargar lista" : "Cargar modelos"}
                </Button>
              ) : null}
              {listError ? <p className="text-warning text-[12px]">{listError}</p> : null}
            </div>
          </SettingsRow>

          {serverManaged ? null : (
            <SettingsRow
              label="Base URL (opcional)"
              htmlFor="base-url"
              description="Para modelos locales, p. ej. http://localhost:1234/v1"
            >
              <Input
                id="base-url"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder="http://localhost:1234/v1"
                className={control}
              />
            </SettingsRow>
          )}
        </SettingsGroup>

        <div className="flex items-center justify-end gap-3">
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          {status ? <p className="text-success text-sm">{status}</p> : null}
          <Button type="submit" disabled={busy || Boolean(current?.unavailable)} className="rounded-full px-5">
            {busy ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </form>
    </>
  );
}
