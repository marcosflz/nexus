import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Inbox } from "@/components/inbox";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <Inbox />;
}
