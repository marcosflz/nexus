import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";

/** Uso del usuario: ejecuciones y tokens por día y por agente en los últimos N días. */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 365);

  const rows = await db.execute<{ day: string; agent: string | null; runs: number; tokens: string; failed: number }>(sql`
    SELECT to_char(date_trunc('day', r.created_at), 'YYYY-MM-DD') AS day,
           a.name AS agent,
           count(*)::int AS runs,
           coalesce(sum((r.usage->>'total')::bigint), 0)::text AS tokens,
           count(*) FILTER (WHERE r.status IN ('error', 'interrupted'))::int AS failed
    FROM runs r
    LEFT JOIN agents a ON a.id = r.agent_id
    WHERE r.user_id = ${user.id} AND r.created_at >= now() - (${days} * interval '1 day')
    GROUP BY 1, 2
    ORDER BY 1 DESC, 2`);

  return NextResponse.json({
    days,
    rows: rows.map((row) => ({
      day: row.day,
      agent: row.agent ?? "Nexus",
      runs: row.runs,
      tokens: Number(row.tokens),
      failed: row.failed,
    })),
  });
}
