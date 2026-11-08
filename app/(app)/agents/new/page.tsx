import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { defaultAgentSpec } from "@/lib/agents/spec";
import { AgentEditor } from "@/components/agents/editor";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return (
    <AgentEditor
      agentId={null}
      initialSpec={defaultAgentSpec({ name: "Nuevo agente" })}
      initialMeta={{ description: "", visibility: "private", status: "active" }}
      canEdit
    />
  );
}
