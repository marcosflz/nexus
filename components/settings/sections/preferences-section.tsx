"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { FOCUS_OPTIONS } from "@/lib/focus";
import { DEFAULT_PREFS, readPrefs, writePrefs, type Prefs } from "@/lib/prefs";
import { SettingsGroup, SettingsRow, SettingsSectionTitle } from "../rows";

const TRIGGER = "h-10 w-full rounded-lg sm:w-72";

export function PreferencesSection() {
  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- se lee de localStorage tras montar
    setPrefs(readPrefs());
    setMounted(true);
  }, []);

  const update = (patch: Partial<Prefs>) => setPrefs(writePrefs(patch));

  return (
    <>
      <SettingsSectionTitle>Preferencias</SettingsSectionTitle>
      <SettingsGroup title="Apariencia">
        <SettingsRow label="Tema">
          <Select value={mounted ? (theme ?? "system") : "system"} onValueChange={setTheme}>
            <SelectTrigger className={TRIGGER} aria-label="Tema">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">Claro</SelectItem>
              <SelectItem value="dark">Oscuro</SelectItem>
              <SelectItem value="system">Sistema</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Búsqueda">
        <SettingsRow label="Fuente predeterminada" description="Dónde busca Nexus si no eliges otra cosa.">
          <Select value={prefs.focus} onValueChange={(focus) => update({ focus })}>
            <SelectTrigger className={TRIGGER} aria-label="Fuente predeterminada">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FOCUS_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow label="Modo predeterminado">
          <Select value={prefs.mode} onValueChange={(mode) => update({ mode: mode as Prefs["mode"] })}>
            <SelectTrigger className={TRIGGER} aria-label="Modo predeterminado">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="search">Búsqueda</SelectItem>
              <SelectItem value="research">Research</SelectItem>
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label="Interfaz generativa"
          description="Responder con tablas, gráficos y formularios cuando aporten."
        >
          <Switch checked={prefs.ui} onCheckedChange={(ui) => update({ ui })} aria-label="Interfaz generativa" />
        </SettingsRow>
      </SettingsGroup>
      <p className="text-muted-fg text-[13px]">Estas preferencias se guardan en este navegador.</p>
    </>
  );
}
