import { redirect } from "next/navigation";
import { UsersPanel } from "@/components/admin/users-panel";
import { isAdminRole } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) redirect("/");
  return <UsersPanel />;
}
