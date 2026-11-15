import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { unreadCount } from "@/lib/notifications/store";

export const runtime = "nodejs";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  return NextResponse.json({ unread: await unreadCount(user.id) });
}
