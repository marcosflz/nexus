import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { UsageDashboard } from "@/components/usage";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return <UsageDashboard />;
}
