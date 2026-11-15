import { redirect } from "next/navigation";
import { SkillsLibrary } from "@/components/skills/library";
import { hasPermission } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function SkillsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!hasPermission(user, "skills")) redirect("/");
  return <SkillsLibrary />;
}
