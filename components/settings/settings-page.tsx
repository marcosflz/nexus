"use client";

import { useState } from "react";
import type { SettingsSection } from "@/components/shell/shell-context";
import { SettingsView } from "./settings-view";

export function SettingsPage({ initialSection, notice }: { initialSection: SettingsSection; notice?: string }) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  return <SettingsView variant="page" section={section} onSectionChange={setSection} notice={notice} />;
}
