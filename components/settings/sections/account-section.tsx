"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Initial } from "@/components/shell/initial";
import { useShell } from "@/components/shell/shell-context";
import { logout } from "@/components/shell/user-menu";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";

function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/account/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: current, newPassword: next }),
    });
    setBusy(false);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "No se pudo cambiar la contraseña");
      return;
    }
    setCurrent("");
    setNext("");
    toast.success("Contraseña cambiada");
  }

  return (
    <form onSubmit={submit} className="grid gap-2 sm:w-72">
      <Input
        type="password"
        required
        placeholder="Contraseña actual"
        aria-label="Contraseña actual"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <Input
        type="password"
        required
        minLength={8}
        placeholder="Contraseña nueva"
        aria-label="Contraseña nueva"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
      />
      {error ? (
        <p role="alert" className="text-danger text-sm">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="outline" disabled={busy} className="rounded-full">
        {busy ? "Guardando…" : "Cambiar contraseña"}
      </Button>
    </form>
  );
}

export function AccountSection() {
  const { user } = useShell();
  const localPart = user.email.split("@")[0];
  return (
    <>
      <SettingsSectionTitle>Cuenta</SettingsSectionTitle>
      <SettingsGroup title="Detalles">
        <SettingsRow label="Foto de perfil">
          <Initial email={user.email} className="size-10" />
        </SettingsRow>
        <SettingsRow label="Usuario">
          <span className="text-muted-fg text-[15px]">{localPart}</span>
        </SettingsRow>
        <SettingsRow label="Correo electrónico">
          <span className="text-muted-fg text-[15px] break-all">{user.email}</span>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Seguridad">
        <SettingsRow label="Contraseña" description="Al cambiarla se cierran tus otras sesiones.">
          <PasswordForm />
        </SettingsRow>
        <SettingsRow
          label="Cifrado de claves"
          description="Tus API keys se guardan cifradas en el servidor (AES-256-GCM) y solo se usan para tus consultas."
        >
          <Badge variant="outline" className="rounded-full">
            Activo
          </Badge>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Sesión">
        <SettingsRow label="Cerrar sesión" description="Cierra la sesión en este navegador.">
          <Button variant="outline" className="rounded-full" onClick={logout}>
            Cerrar sesión
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
