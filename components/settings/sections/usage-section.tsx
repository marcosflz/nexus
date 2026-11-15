"use client";

import { UsageContent } from "@/components/usage";
import { SettingsSectionTitle } from "../rows";

export function UsageSection() {
  return (
    <>
      <SettingsSectionTitle>Uso</SettingsSectionTitle>
      <UsageContent />
    </>
  );
}
