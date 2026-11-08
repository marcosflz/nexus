"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Initial } from "@/components/shell/initial";
import { useShell } from "@/components/shell/shell-context";
import { logout } from "@/components/shell/user-menu";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";

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
