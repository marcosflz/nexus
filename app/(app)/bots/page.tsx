import { redirect } from "next/navigation";
import { BotsPage } from "@/components/bots/bots-page";
import { hasPermission } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NexBotsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "bots")) redirect("/");
  return <BotsPage />;
}
