import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { SettingsPage } from "@/components/settings/settings-page";
import type { SettingsSection } from "@/components/shell/shell-context";

export const dynamic = "force-dynamic";

const VALID: SettingsSection[] = ["account", "preferences", "models", "connectors", "usage"];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { aviso, seccion } = await searchParams;
  const notice =
    aviso === "sin-credencial"
      ? "Antes de chatear necesitas configurar un proveedor y su API key."
      : undefined;
  const requested = typeof seccion === "string" ? (seccion as SettingsSection) : null;
  const initialSection: SettingsSection =
    requested && VALID.includes(requested) ? requested : notice ? "models" : "account";
  return <SettingsPage initialSection={initialSection} notice={notice} />;
}
