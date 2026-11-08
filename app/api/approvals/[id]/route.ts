import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { approvals } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { launchResume } from "@/lib/runs/launch";

export const runtime = "nodejs";

const bodySchema = z.object({ decision: z.enum(["approve", "deny"]), reason: z.string().max(500).optional() });

/**
 * Decide una aprobación pendiente (p. ej. desde la bandeja) y reanuda el run
 * que la esperaba. La reanudación continúa en segundo plano.
 */
export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const { id } = await context.params;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Petición no válida" }, { status: 400 });
  }

  const [approval] = await db
    .select()
    .from(approvals)
    .where(and(eq(approvals.id, id), eq(approvals.userId, user.id), eq(approvals.status, "pending")))
    .limit(1);
  if (!approval?.toolCallId) {
    return NextResponse.json({ error: "Aprobación no encontrada o ya decidida" }, { status: 404 });
  }

  const approve = parsed.data.decision === "approve";
  const launched = await launchResume({
    userId: user.id,
    runId: approval.runId,
    entries: [
      {
        callId: approval.toolCallId,
        status: approve ? "approved" : "denied",
        reason: approve ? undefined : (parsed.data.reason ?? "Rechazado por el usuario"),
        approvalId: approval.id,
      },
    ],
  });
  if (!launched.ok) return NextResponse.json({ error: launched.error }, { status: launched.status });
  return NextResponse.json({ ok: true });
}
