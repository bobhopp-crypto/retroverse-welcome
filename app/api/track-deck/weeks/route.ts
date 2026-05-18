import { NextResponse } from "next/server";

import { loadTrackDeckWeekIndex } from "@/lib/track-deck/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const yearRaw = url.searchParams.get("year")?.trim();
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : undefined;

  try {
    const index = loadTrackDeckWeekIndex(Number.isFinite(year) ? year : undefined);
    return NextResponse.json({ ok: true, ...index });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
