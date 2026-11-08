import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  destroySession,
  LEGACY_SESSION_COOKIE,
  readSessionToken,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const store = await cookies();
  const token = readSessionToken(store);
  if (token) await destroySession(token);

  const res = NextResponse.json({ ok: true });
  for (const name of [SESSION_COOKIE, LEGACY_SESSION_COOKIE]) {
    res.cookies.set(name, "", {
      ...sessionCookieOptions(req),
      expires: new Date(0),
    });
  }
  return res;
}
