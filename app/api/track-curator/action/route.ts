import { NextResponse } from "next/server";

import { appendTrackCuratorDecision, type TrackCuratorAction } from "@/lib/track-curator/decisions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set<TrackCuratorAction>([
  "accept",
  "reject",
  "mark_live",
  "mark_alt",
  "split",
  "merge",
]);

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const action = typeof o.action === "string" ? o.action : "";
  if (!ACTIONS.has(action as TrackCuratorAction)) {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  const artist = typeof o.artist === "string" ? o.artist.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!artist || !title) {
    return NextResponse.json({ ok: false, error: "artist_and_title_required" }, { status: 400 });
  }

  const retroverseTrackId =
    typeof o.retroverseTrackId === "string" && o.retroverseTrackId.trim()
      ? o.retroverseTrackId.trim().toUpperCase()
      : null;
  const filePath = typeof o.filePath === "string" ? o.filePath.trim() : undefined;

  if (action === "accept" && !filePath) {
    return NextResponse.json({ ok: false, error: "file_path_required_for_accept" }, { status: 400 });
  }

  try {
    await appendTrackCuratorDecision({
      action: action as TrackCuratorAction,
      retroverseTrackId,
      artist,
      title,
      filePath,
      note: typeof o.note === "string" ? o.note : undefined,
    });
    return NextResponse.json({ ok: true, action });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
