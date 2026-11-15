import { redirect } from "next/navigation";
import { BotDetail } from "@/components/bots/bot-detail";
import { hasPermission } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NexBotPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "bots")) redirect("/");
  const { id } = await params;
  return <BotDetail key={id} botId={id} />;
}
