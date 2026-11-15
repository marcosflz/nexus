"use client";

import { Plus, Star, Trash2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { notifyModelsChanged } from "@/lib/models/selection";
import { cn } from "@/lib/utils";
import { ClaudeAccountLink } from "../sections/claude-account-link";
import { ChatGptAccountLink } from "./chatgpt-account-link";
import { ModelChooser, type ModelEntry } from "./model-chooser";

interface ProviderView {
  id: string;
  label: string;
  kind: "api" | "subscription";
  linkFlow: "key" | "claude" | "chatgpt";
  hint: string | null;
  needsKey: boolean;
  placeholder: string | null;
  canList: boolean;
  allowedModels: string[] | null;
  defaultModel: string;
  unavailable: string | null;
  account: { linked: boolean; ready: boolean; reason: string | null; account?: string | null } | null;
  config: {
    enabled: boolean;
    hasKey: boolean;
    baseUrl: string | null;
    model: string;
    models: ModelEntry[];
    isDefault: boolean;
  } | null;
}

async function put(body: object): Promise<boolean> {
  const res = await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    toast.error(data.error ?? "No se pudo guardar");
  }
  return res.ok;
}

/**
 * Lista de proveedores de un tipo (`api` o `subscription`). Varios pueden estar activos a la vez;
 * cada uno con su credencial y los modelos que el usuario quiere ver.
 */
export function ProviderList({ kind }: { kind: "api" | "subscription" }) {
  const [providers, setProviders] = useState<ProviderView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Proveedores de clave añadidos en esta sesión pero aún sin guardar. */
  const [drafts, setDrafts] = useState<string[]>([]);

  const load = useCallback(() => {
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("error"))))
      .then((data: { providers: ProviderView[] }) => {
        setProviders(data.providers.filter((p) => p.kind === kind));
        setError(null);
      })
      .then(notifyModelsChanged)
      .catch(() => setError("No se pudo cargar la configuración"));
  }, [kind]);

  useEffect(load, [load]);

  if (error) {
    return (
      <p role="alert" className="text-danger text-sm">
        {error}
      </p>
    );
  }
  if (!providers) return <Skeleton className="h-48 w-full rounded-xl" />;

  // Las suscripciones vinculables se muestran siempre; el resto, cuando se añaden.
  const shown = providers.filter((p) => p.config || drafts.includes(p.id) || (kind === "subscription" && p.linkFlow !== "key"));
  const addable = providers.filter((p) => !shown.includes(p));

  return (
    <div className="flex flex-col gap-4">
      {shown.length === 0 ? (
        <p className="text-muted-fg border-border rounded-xl border border-dashed px-4 py-6 text-center text-sm">
          {kind === "api"
            ? "Aún no has añadido ningún servicio con clave de API."
            : "No tienes suscripciones disponibles. Un administrador debe darte permiso."}
        </p>
      ) : null}
      {shown.map((provider) => (
        <ProviderCard
          key={provider.id}
          provider={provider}
          onChange={() => {
            setDrafts((prev) => prev.filter((id) => id !== provider.id));
            load();
          }}
          onDiscard={() => setDrafts((prev) => prev.filter((id) => id !== provider.id))}
        />
      ))}
      {addable.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" className="self-start rounded-full">
              <Plus className="size-4" /> Añadir {kind === "api" ? "servicio" : "suscripción"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {addable.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => setDrafts((prev) => [...prev, p.id])}>
                {p.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function ProviderCard({
  provider,
  onChange,
  onDiscard,
}: {
  provider: ProviderView;
  onChange: () => void;
  onDiscard: () => void;
}) {
  const { config } = provider;
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const linked = provider.linkFlow !== "key";
  const ready = linked ? Boolean(provider.account?.linked) : Boolean(config && (config.hasKey || !provider.needsKey));
  const models = config?.models ?? [];
  const showBaseUrl = provider.id === "lmstudio";

  async function saveKey(event: React.FormEvent) {
    event.preventDefault();
    if (!apiKey.trim() && config) return;
    setBusy(true);
    const ok = await put({
      provider: provider.id,
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      ...(showBaseUrl ? { baseUrl: baseUrl.trim() } : {}),
      ...(config ? {} : { models: [{ id: provider.defaultModel, label: provider.defaultModel }], model: provider.defaultModel }),
    });
    setBusy(false);
    if (ok) {
      setApiKey("");
      toast.success(config ? "Clave actualizada" : `${provider.label} añadido`);
      onChange();
    }
  }

  async function setEnabled(enabled: boolean) {
    if (await put({ provider: provider.id, enabled })) onChange();
  }

  async function saveModels(next: ModelEntry[]): Promise<boolean> {
    const model = next.some((m) => m.id === config?.model) ? config?.model : next[0]?.id;
    const ok = await put({ provider: provider.id, models: next, model });
    if (ok) onChange();
    return ok;
  }

  async function makeDefault(model: string) {
    const res = await fetch("/api/settings/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: provider.id, model }),
    });
    if (res.ok) {
      toast.success("Modelo predeterminado actualizado");
      onChange();
    } else {
      toast.error("No se pudo cambiar el predeterminado");
    }
  }

  async function remove() {
    const res = await fetch(`/api/settings?provider=${encodeURIComponent(provider.id)}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(`${provider.label} eliminado`);
      onChange();
    }
  }

  let status = "Sin configurar";
  let tone = "text-muted-fg";
  if (provider.unavailable) {
    status = "No disponible";
    tone = "text-warning";
  } else if (ready && config && !config.enabled) {
    status = "Desactivado";
  } else if (ready && (!linked || provider.account?.ready)) {
    status = "Activo";
    tone = "text-success";
  } else if (linked && provider.account?.linked) {
    status = "Revisar";
    tone = "text-warning";
  } else if (linked) {
    status = "Sin vincular";
  }

  return (
    <section className={cn("border-border bg-surface rounded-xl border", config && !config.enabled && "opacity-80")}>
      <header className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h3 className="text-[16px] font-medium">{provider.label}</h3>
          {provider.hint ? <p className="text-muted-fg mt-0.5 text-[13px]">{provider.hint}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <span className={cn("text-[13px]", tone)}>{status}</span>
          {config && ready ? (
            <Switch
              checked={config.enabled}
              onCheckedChange={(v) => void setEnabled(v)}
              aria-label={`Activar ${provider.label}`}
            />
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 py-4">
        {provider.unavailable ? <p className="text-warning text-[13px]">{provider.unavailable}</p> : null}

        {provider.linkFlow === "claude" && !provider.unavailable ? (
          <ClaudeAccountLink account={provider.account} unavailable={null} onChange={onChange} />
        ) : null}
        {provider.linkFlow === "chatgpt" ? (
          <ChatGptAccountLink
            linked={Boolean(provider.account?.linked)}
            account={provider.account?.account ?? null}
            reason={provider.account?.reason ?? null}
            onChange={onChange}
          />
        ) : null}

        {provider.linkFlow === "key" ? (
          <form onSubmit={saveKey} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <label htmlFor={`key-${provider.id}`} className="text-[13px] font-medium">
                API key{provider.needsKey ? "" : " (opcional)"}
              </label>
              <Input
                id={`key-${provider.id}`}
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={config?.hasKey ? "•••••••• (guardada; escribe para reemplazar)" : (provider.placeholder ?? "Tu API key")}
                className="h-10 rounded-lg"
              />
              {showBaseUrl ? (
                <Input
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="URL base, p. ej. http://localhost:1234/v1"
                  aria-label="URL base"
                  className="h-10 rounded-lg"
                />
              ) : null}
            </div>
            <Button
              type="submit"
              className="rounded-full px-5"
              disabled={busy || (provider.needsKey && !apiKey.trim() && !config?.hasKey) || (Boolean(config) && !apiKey.trim() && !showBaseUrl)}
            >
              {busy ? "Guardando…" : config ? "Guardar" : "Añadir"}
            </Button>
          </form>
        ) : null}

        {config && ready ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">
                Modelos activos <span className="text-muted-fg font-normal">({models.length})</span>
              </span>
              <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={() => setChoosing(true)}>
                Elegir modelos
              </Button>
            </div>
            {models.length === 0 ? (
              <p className="text-warning text-[13px]">No hay ningún modelo activo: elige al menos uno.</p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {models.map((m) => {
                  const isDefault = config.isDefault && config.model === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        title={isDefault ? "Tu modelo predeterminado" : "Usar como predeterminado"}
                        onClick={() => (isDefault ? undefined : void makeDefault(m.id))}
                        className={cn(
                          "border-border inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px]",
                          isDefault ? "border-brand/50 bg-brand-soft" : "hover:bg-muted",
                        )}
                      >
                        {isDefault ? <Star className="size-3 fill-current" /> : null}
                        {m.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {config || (provider.linkFlow === "key" && !config) ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-fg rounded-full"
              onClick={() => (config ? setConfirmDelete(true) : onDiscard())}
            >
              <Trash2 className="size-3.5" /> {config ? "Quitar" : "Descartar"}
            </Button>
          </div>
        ) : null}
      </div>

      {config ? (
        <ModelChooser
          open={choosing}
          onOpenChange={setChoosing}
          provider={provider.id}
          label={provider.label}
          canList={provider.canList}
          allowedModels={provider.allowedModels}
          selected={models}
          onSave={saveModels}
        />
      ) : null}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Quitar {provider.label}?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borran su credencial y la lista de modelos. Los agentes que lo usen dejarán de funcionar hasta que lo
              vuelvas a configurar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
