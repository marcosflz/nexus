import { z } from "zod";
import { authenticateInternal } from "@/lib/internal/auth";
import { evaluateToolCall } from "@/lib/policy/gateway";
import { defaultGatewayDeps } from "@/lib/policy/deps";
import { isHumanInControl } from "@/lib/sandbox/control";
import { decideRuntimeAction } from "@/lib/policy/runtime";

export const runtime = "nodejs";

const bodySchema = z.object({
  tool: z.string().min(1).max(200),
  args: z.unknown().optional(),
  toolCallId: z.string().max(200).optional(),
});

/** El sidecar pregunta aquí antes de ejecutar cada herramienta con efectos. */
export async function POST(req: Request) {
  const auth = await authenticateInternal(req);
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Petición no válida" }, { status: 400 });

  const verdict = await evaluateToolCall(
    {
      tool: parsed.data.tool,
      args: parsed.data.args ?? {},
      toolCallId: parsed.data.toolCallId,
      run: auth.run,
      humanInControl: await isHumanInControl(auth.run.agentId),
    },
    { ...defaultGatewayDeps, decide: (request) => decideRuntimeAction(request, auth.run.runtimeSnapshot?.spec) },
  );
  return Response.json(verdict);
}
