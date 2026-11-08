import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvals } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/** Aprobaciones pendientes del usuario, para la bandeja. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const rows = await db
    .select({
      id: approvals.id,
      runId: approvals.runId,
      tool: approvals.tool,
      args: approvals.args,
      reason: approvals.reason,
      createdAt: approvals.createdAt,
    })
    .from(approvals)
    .where(and(eq(approvals.userId, user.id), eq(approvals.status, "pending")));
  return NextResponse.json({ approvals: rows });
}
