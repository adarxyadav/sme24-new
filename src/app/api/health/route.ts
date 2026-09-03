import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Uptime probe. Unlocalized, skipped by the proxy. */
export function GET() {
  return NextResponse.json({ ok: true, time: new Date().toISOString() });
}
