"use client";

import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export interface ModelEntry {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Elige qué modelos de un proveedor se muestran en el chat y en los agentes. El catálogo se
 * pide al proveedor (con la clave o la cuenta vinculada del usuario); si no se puede listar,
 * se escriben a mano.
 */
export function ModelChooser({
  open,
  onOpenChange,
  provider,
  label,
  canList,
  allowedModels,
  selected,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  provider: string;
  label: string;
  canList: boolean;
  /** Lista cerrada impuesta por un admin. */
  allowedModels: string[] | null;
  selected: ModelEntry[];
  onSave: (models: ModelEntry[]) => Promise<boolean>;
}) {
  const [catalog, setCatalog] = useState<ModelEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Map<string, ModelEntry>>(new Map());
  const [custom, setCustom] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChosen(new Map(selected.map((m) => [m.id, m])));
    setQuery("");
    setCustom("");
    setError(null);
    if (allowedModels) {
      setCatalog(allowedModels.map((id) => ({ id, label: selected.find((m) => m.id === id)?.label ?? id })));
      return;
    }
    if (!canList) {
      setCatalog([]);
      return;
    }
    setCatalog(null);
    let cancelled = false;
    fetch("/api/settings/models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider }),
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => ({}))) as { catalog?: ModelEntry[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "No se pudieron cargar los modelos");
          setCatalog([]);
        } else {
          setCatalog(data.catalog ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("No se pudo contactar con el servidor");
          setCatalog([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, provider, canList, allowedModels, selected]);

  // Lo ya elegido que no está en el catálogo (escrito a mano o retirado) también se muestra.
  const all = useMemo(() => {
    const list = [...(catalog ?? [])];
    for (const model of chosen.values()) if (!list.some((m) => m.id === model.id)) list.unshift(model);
    return list;
  }, [catalog, chosen]);
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? all.filter((m) => m.id.toLowerCase().includes(needle) || m.label.toLowerCase().includes(needle))
    : all;

  function toggle(model: ModelEntry, on: boolean) {
    setChosen((prev) => {
      const next = new Map(prev);
      if (on) next.set(model.id, model);
      else next.delete(model.id);
      return next;
    });
  }

  function addCustom() {
    const id = custom.trim();
    if (!id) return;
    toggle({ id, label: id }, true);
    setCustom("");
  }

  async function save() {
    setSaving(true);
    // Se conserva el orden del catálogo.
    const ordered = all.filter((m) => chosen.has(m.id)).map((m) => ({ id: m.id, label: chosen.get(m.id)!.label }));
    const ok = await onSave(ordered);
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85svh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Modelos de {label}</DialogTitle>
          <DialogDescription>
            Solo los modelos activos aparecen en el selector del chat y en los agentes.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="text-muted-fg pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar modelo"
            aria-label="Buscar modelo"
            className="h-10 rounded-lg pl-9"
          />
        </div>

        <div className="text-muted-fg flex items-center justify-between text-[13px]">
          <span>
            {chosen.size} activo{chosen.size === 1 ? "" : "s"}
            {catalog ? ` de ${all.length}` : ""}
          </span>
          <span className="flex gap-3">
            <button
              type="button"
              className="hover:text-fg underline-offset-2 hover:underline"
              onClick={() => setChosen(new Map([...chosen, ...visible.map((m) => [m.id, m] as const)]))}
            >
              Activar {needle ? "los filtrados" : "todos"}
            </button>
            <button
              type="button"
              className="hover:text-fg underline-offset-2 hover:underline"
              onClick={() => {
                const next = new Map(chosen);
                for (const m of visible) next.delete(m.id);
                setChosen(next);
              }}
            >
              Ninguno
            </button>
          </span>
        </div>

        <div className="border-border min-h-40 flex-1 overflow-y-auto rounded-lg border">
          {catalog === null ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <p className="text-muted-fg p-4 text-sm">
              {error ?? (needle ? "Ningún modelo coincide." : "Este proveedor no permite listar modelos: añádelos abajo.")}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {visible.map((model) => {
                const id = `model-${provider}-${model.id}`;
                return (
                  <li key={model.id} className="flex items-center gap-3 px-3 py-2">
                    <Checkbox id={id} checked={chosen.has(model.id)} onCheckedChange={(v) => toggle(model, v === true)} />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block truncate text-[14px]">{model.label}</span>
                      {model.label !== model.id ? (
                        <span className="text-muted-fg block truncate text-[12px]">{model.id}</span>
                      ) : null}
                      {model.hint ? <span className="text-warning block text-[12px]">{model.hint}</span> : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {error && catalog?.length === 0 && !needle ? <p className="text-warning text-[13px]">{error}</p> : null}

        {allowedModels ? null : (
          <div className="flex gap-2">
            <Input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addCustom();
                }
              }}
              placeholder="Añadir un modelo por su nombre"
              aria-label="Añadir modelo por nombre"
              className="h-9 rounded-lg"
            />
            <Button type="button" variant="outline" size="sm" className="h-9 rounded-full" onClick={addCustom}>
              Añadir
            </Button>
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" className="rounded-full px-5" disabled={saving || chosen.size === 0} onClick={() => void save()}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
