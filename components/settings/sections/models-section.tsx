"use client";

import { ProviderList } from "../providers/provider-list";
import { SettingsSectionTitle } from "../rows";

/** Servicios con clave de API (OpenRouter, OpenAI, Anthropic…). Varios pueden estar activos a la vez. */
export function ModelsSection() {
  return (
    <>
      <SettingsSectionTitle>Claves de API</SettingsSectionTitle>
      <p className="text-muted-fg -mt-5 mb-6 text-[14px]">
        Conecta los servicios que pagas por uso con tu clave. Puedes tener varios activos y elegir qué modelos de cada
        uno aparecen en el chat. Las claves se guardan cifradas y solo se usan para tus consultas.
      </p>
      <ProviderList kind="api" />
    </>
  );
}
