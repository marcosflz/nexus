"use client";

import Link from "next/link";
import { useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useShell, type SettingsSection } from "@/components/shell/shell-context";
import { isAdminRole } from "@/lib/access";
import { matchesSettings } from "@/lib/settings-search";
import { cn } from "@/lib/utils";
import { SETTINGS_ITEMS, SETTINGS_LINKS } from "./sections";
import { AccountSection } from "./sections/account-section";
import { AssistantSection } from "./sections/assistant-section";
import { ClaudeCodeSection } from "./sections/claude-code-section";
import { ConnectorsSection } from "./sections/connectors-section";
import { ModelsSection } from "./sections/models-section";
import { SubscriptionsSection } from "./sections/subscriptions-section";
import { PreferencesSection } from "./sections/preferences-section";
import { UsageSection } from "./sections/usage-section";
import { SearchSection } from "./sections/search-section";

const NAV_BTN =
  "flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-[15px] transition-colors [&_svg]:size-[18px]";

export function SettingsView({
  variant,
  section,
  onSectionChange,
  notice,
  onClose,
}: {
  variant: "dialog" | "page";
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  notice?: string;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState("");
  const { user } = useShell();
  const isSuperadmin = user.role === "superadmin";
  const isAdmin = isAdminRole(user.role);
  const allowed = SETTINGS_ITEMS.filter(
    (i) =>
      (!i.adminOnly || isAdmin) &&
      (!i.superadminOnly || isSuperadmin) &&
      (!i.permission || user.permissions[i.permission]),
  );
  const items = allowed.filter((i) => matchesSettings(query, i.label, i.keywords));
  const links = SETTINGS_LINKS.filter(
    (l) =>
      (!l.permission || user.permissions[l.permission]) &&
      (!l.adminOnly || isAdmin) &&
      matchesSettings(query, l.label, l.keywords),
  );
  const groups = (["Cuenta", "Herramientas", "Administración"] as const)
    .map((group) => ({ group, items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className={cn("grid min-h-0 grid-cols-1 md:grid-cols-[292px_1fr]", variant === "dialog" ? "h-full" : "min-h-svh")}>
      <nav className="border-border hidden min-h-0 flex-col overflow-y-auto border-r p-2.5 md:flex">
        <div className="relative mb-2">
          <Search className="text-muted-fg pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar ajustes"
            aria-label="Buscar ajustes"
            className="h-11 rounded-lg bg-transparent pl-9 text-[15px]"
          />
        </div>
        {groups.map(({ group, items: groupItems }) => (
          <div key={group}>
            <p className="text-muted-fg px-3 pt-5 pb-2 text-[13px]">{group}</p>
            {groupItems.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => onSectionChange(id)}
                aria-current={section === id ? "page" : undefined}
                className={cn(NAV_BTN, section === id ? "bg-surface-2 text-fg" : "text-fg/85 hover:bg-surface-2")}
              >
                <Icon />
                {label}
              </button>
            ))}
          </div>
        ))}
        {links.length > 0 ? (
          <div>
            <p className="text-muted-fg px-3 pt-5 pb-2 text-[13px]">Otros</p>
            {links.map(({ href, label, icon: Icon }) => (
              <Link
                key={href}
                href={href}
                onClick={() => onClose?.()}
                className={cn(NAV_BTN, "text-fg/85 hover:bg-surface-2")}
              >
                <Icon />
                {label}
                <ExternalLink className="text-muted-fg ml-auto size-3.5!" />
              </Link>
            ))}
          </div>
        ) : null}
        {groups.length === 0 && links.length === 0 ? (
          <p className="text-muted-fg px-3 py-4 text-sm">Sin resultados.</p>
        ) : null}
      </nav>

      <div className="min-h-0 overflow-y-auto px-5 py-8 md:px-10 md:py-10">
        <div className="mb-6 md:hidden">
          <Select value={section} onValueChange={(value) => onSectionChange(value as SettingsSection)}>
            <SelectTrigger className="h-10 w-full rounded-lg" aria-label="Sección de ajustes">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {allowed.map((item) => (
                <SelectItem key={item.id} value={item.id}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {notice ? (
          <p role="status" className="border-brand/40 bg-brand-soft mb-6 rounded-xl border px-4 py-3 text-sm">
            {notice}
          </p>
        ) : null}
        {section === "account" ? <AccountSection /> : null}
        {section === "preferences" ? <PreferencesSection /> : null}
        {section === "models" ? <ModelsSection /> : null}
        {section === "subscriptions" ? <SubscriptionsSection /> : null}
        {section === "connectors" && user.permissions.connectors ? <ConnectorsSection /> : null}
        {section === "usage" ? <UsageSection /> : null}
        {section === "search" && isAdmin ? <SearchSection /> : null}
        {section === "assistant" && isSuperadmin ? <AssistantSection /> : null}
        {section === "claudeCode" && isSuperadmin ? <ClaudeCodeSection /> : null}
      </div>
    </div>
  );
}
