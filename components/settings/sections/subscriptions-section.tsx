"use client";

import { ProviderList } from "../providers/provider-list";
import { SettingsSectionTitle } from "../rows";

/** Suscripciones personales (Claude, ChatGPT, OpenCode Go). Cada una es de su usuario y no se comparte. */
export function SubscriptionsSection() {
  return (
    <>
      <SettingsSectionTitle>Suscripciones</SettingsSectionTitle>
      <p className="text-muted-fg -mt-5 mb-6 text-[14px]">
        Usa tus propios planes con tus agentes. Cada cuenta es tuya: se vincula a tu usuario de Nexus y nunca se
        comparte con otras personas. El uso cuenta para los límites de tu plan.
      </p>
      <ProviderList kind="subscription" />
    </>
  );
}
