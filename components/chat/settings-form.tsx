"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface ProviderOption {
  id: string;
  label: string;
  needsKey: boolean;
  defaultModel: string;
  /** El proveedor expone un endpoint de listado de modelos. */
  canListModels: boolean;
}

export function SettingsForm({ email }: { email: string }) {
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
        }) => {
          setProviders(data.providers ?? []);
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
      if (current?.canListModels && nowHasKey) void loadModels(provider, "");
    } else {
      setError(data.error ?? "No se pudo guardar");
    }
    setBusy(false);
  }

  const modelIsListed = models.includes(model);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Ajustes</h1>
          <p className="text-sm text-neutral-400">{email}</p>
        </div>
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← Volver al chat
        </Link>
      </div>

      <form
        onSubmit={save}
        className="space-y-5 rounded-xl border border-neutral-800 bg-neutral-900/60 p-6"
      >
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Proveedor</label>
          <select
            value={provider}
            onChange={(event) => {
              const next = event.target.value;
              setProvider(next);
              const info = providers.find((p) => p.id === next);
              if (info) setModel(info.defaultModel);
            }}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            API key {current && !current.needsKey ? "(opcional)" : ""}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            onBlur={() => {
              // Al pegar la clave se listan los modelos solos: el usuario no
              // tiene que saberse el identificador exacto.
              if (current?.canListModels && apiKey.trim().length >= 8) {
                void loadModels(provider, apiKey);
              }
            }}
            placeholder={hasKey ? "•••••••• (guardada; escribe para reemplazar)" : "Tu API key"}
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          />
          <p className="text-xs text-neutral-500">
            Se cifra en el servidor (AES-256-GCM) y solo se usa para tus consultas.
          </p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-sm font-medium">Modelo</label>
            {current?.canListModels ? (
              <button
                type="button"
                onClick={() => void loadModels(provider, apiKey)}
                disabled={listing}
                className="text-xs text-sky-400 hover:underline disabled:opacity-50"
              >
                {listing ? "Consultando…" : models.length > 0 ? "Recargar lista" : "Cargar modelos"}
              </button>
            ) : null}
          </div>

          {models.length > 0 ? (
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            >
              {model && !modelIsListed ? <option value={model}>{model} (actual)</option> : null}
              {model === "" ? <option value="">Elige un modelo…</option> : null}
              {models.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="p. ej. anthropic/claude-sonnet-4.6"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
            />
          )}

          {models.length > 0 ? (
            <p className="text-xs text-neutral-500">
              {models.length} modelos disponibles en {current?.label}.
            </p>
          ) : null}
          {listError ? <p className="text-xs text-amber-400">{listError}</p> : null}
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Base URL (opcional)</label>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="http://localhost:1234/v1 para modelos locales"
            className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-neutral-600"
          />
        </div>

        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {status ? <p className="text-sm text-emerald-400">{status}</p> : null}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 hover:bg-white disabled:opacity-50"
        >
          {busy ? "Guardando..." : "Guardar"}
        </button>
      </form>
    </main>
  );
}
