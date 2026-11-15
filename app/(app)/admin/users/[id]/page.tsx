import { redirect } from "next/navigation";
import { UserDetailView } from "@/components/admin/user-detail";
import { isAdminRole } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isAdminRole(user.role)) redirect("/");
  const { id } = await params;
  return <UserDetailView key={id} userId={id} />;
}
