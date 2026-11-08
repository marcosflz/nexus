import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { canEditAgent } from "@/lib/agents/access";
import { resolveAgent } from "@/lib/agents/store";
import { AgentEditor } from "@/components/agents/editor";

export const dynamic = "force-dynamic";

export default async function EditAgentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const resolved = await resolveAgent(user.id, id);
  if (!resolved) notFound();
  return (
    <AgentEditor
      agentId={id}
      initialSpec={resolved.spec}
      initialMeta={{
        description: resolved.agent.description,
        visibility: resolved.agent.visibility,
        status: resolved.agent.status,
      }}
      canEdit={canEditAgent(user.id, resolved.agent)}
    />
  );
}
