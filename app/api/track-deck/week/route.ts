import { NextResponse } from "next/server";

import { enrichTrackDeckWeekPlayback } from "@/lib/track-deck/playback-enrich";
import { nearestTrackDeckWeek, loadTrackDeckWeek } from "@/lib/track-deck/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date")?.trim() ?? "";
  const neighbor = url.searchParams.get("neighbor")?.trim();

  if (neighbor === "prev" || neighbor === "next") {
    if (!DATE_RE.test(date)) {
      return NextResponse.json({ ok: false, error: "invalid_date" }, { status: 400 });
    }
    try {
      const adjacent = nearestTrackDeckWeek(date, neighbor);
      return NextResponse.json({ ok: true, issueDate: adjacent });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: message }, { status: 503 });
    }
  }

  if (!DATE_RE.test(date)) {
    return NextResponse.json({ ok: false, error: "invalid_date" }, { status: 400 });
  }

  try {
    const payload = loadTrackDeckWeek(date);
    if (!payload) {
      return NextResponse.json({ ok: false, error: "week_not_found" }, { status: 404 });
    }
    const enriched = await enrichTrackDeckWeekPlayback(payload);
    return NextResponse.json({ ok: true, ...enriched });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 503 });
  }
}
