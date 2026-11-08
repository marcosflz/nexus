import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listProjectsFor, listThreadsFor } from "@/lib/threads/queries";
import { AppShell } from "@/components/shell/app-shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const [threads, projects, store] = await Promise.all([
    listThreadsFor(user.id),
    listProjectsFor(user.id),
    cookies(),
  ]);
  // Misma cookie que escribe SidebarProvider al plegar o desplegar.
  const sidebarOpen = store.get("sidebar_state")?.value !== "false";
  return (
    <AppShell
      user={{ id: user.id, email: user.email, role: user.role }}
      initialThreads={threads}
      initialProjects={projects}
      sidebarOpen={sidebarOpen}
    >
      {children}
    </AppShell>
  );
}
