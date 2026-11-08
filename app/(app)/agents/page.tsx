import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listAgentsFor } from "@/lib/agents/store";
import { AgentsGallery } from "@/components/agents/gallery";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const agents = await listAgentsFor(user.id);
  return (
    <AgentsGallery
      agents={agents.map((agent) => ({
        id: agent.id,
        slug: agent.slug,
        name: agent.name,
        avatar: agent.avatar,
        description: agent.description,
        visibility: agent.visibility,
        status: agent.status,
        mine: agent.mine,
      }))}
    />
  );
}
