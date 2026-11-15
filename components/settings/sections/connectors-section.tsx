"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Connector {
  id: string;
  name: string;
  url: string;
  transport: string;
  authType: string;
  hasSecret: boolean;
}

/** Conectores MCP del usuario: servidores de herramientas externas que sus agentes pueden usar. */
export function ConnectorsSection() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authType, setAuthType] = useState("bearer");
  const [headerName, setHeaderName] = useState("X-Api-Key");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/connectors");
    if (res.ok) setConnectors(((await res.json()) as { connectors: Connector[] }).connectors);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/connectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          url,
          authType,
          headerName: authType === "header" ? headerName : undefined,
          secret: authType === "none" ? undefined : secret,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo crear el conector");
      setName("");
      setUrl("");
      setSecret("");
      toast.success("Conector añadido");
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo crear el conector");
    } finally {
      setBusy(false);
    }
  }

  async function remove(connector: Connector) {
    const res = await fetch(`/api/connectors/${connector.id}`, { method: "DELETE" });
    if (!res.ok) return toast.error("No se pudo eliminar");
    await load();
  }

  return (
    <>
      <SettingsSectionTitle>Conectores</SettingsSectionTitle>
      <p className="text-muted-fg -mt-6 mb-8 text-[14px]">
        Servidores MCP (calendario, GitHub, bases de datos…) que tus agentes pueden usar. El secreto se guarda cifrado y
        no se vuelve a mostrar. Solo se admiten servidores públicos por https.
      </p>

      <SettingsGroup title="Tus conectores">
        {connectors.length === 0 ? (
          <SettingsRow label="Sin conectores" description="Añade uno con el formulario de abajo." />
        ) : (
          connectors.map((connector) => (
            <SettingsRow
              key={connector.id}
              label={connector.name}
              description={`${connector.url} · ${connector.hasSecret ? "con secreto" : "sin autenticación"}`}
            >
              <Button variant="ghost" size="icon-sm" aria-label={`Eliminar ${connector.name}`} onClick={() => remove(connector)}>
                <Trash2 className="size-4" />
              </Button>
            </SettingsRow>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup title="Añadir conector">
        <form onSubmit={create} className="space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="c-name">Nombre</Label>
            <Input id="c-name" value={name} maxLength={32} required pattern="[A-Za-z0-9_-]+" onChange={(e) => setName(e.target.value)} placeholder="github" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-url">URL del servidor</Label>
            <Input id="c-url" value={url} required onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.ejemplo.com/mcp" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <Label>Autenticación</Label>
            <Select value={authType} onValueChange={setAuthType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Ninguna</SelectItem>
                <SelectItem value="bearer">Bearer token</SelectItem>
                <SelectItem value="header">Cabecera propia</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authType !== "none" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {authType === "header" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="c-header">Cabecera</Label>
                  <Input id="c-header" value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="c-secret">Secreto</Label>
                <Input id="c-secret" type="password" autoComplete="off" value={secret} required onChange={(e) => setSecret(e.target.value)} />
              </div>
            </div>
          ) : null}
        </div>
        <Button type="submit" disabled={busy} className="rounded-full">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Añadir conector
        </Button>
        </form>
      </SettingsGroup>
    </>
  );
}
