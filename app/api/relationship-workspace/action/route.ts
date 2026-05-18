import { NextResponse } from "next/server";

import {
  appendRelationshipWorkspaceDecision,
  type RelationshipWorkspaceAction,
} from "@/lib/relationship-workspace/decisions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ACTIONS = new Set<RelationshipWorkspaceAction>([
  "link",
  "reject",
  "mark_same_track",
  "mark_alt_version",
  "mark_live_version",
  "mark_needs_review",
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
  if (!ACTIONS.has(action as RelationshipWorkspaceAction)) {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  const artist = typeof o.artist === "string" ? o.artist.trim() : "";
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!artist || !title) {
    return NextResponse.json({ ok: false, error: "artist_and_title_required" }, { status: 400 });
  }

  try {
    await appendRelationshipWorkspaceDecision({
      action: action as RelationshipWorkspaceAction,
      artist,
      title,
      retroverseTrackId:
        typeof o.retroverseTrackId === "string" && o.retroverseTrackId.trim()
          ? o.retroverseTrackId.trim().toUpperCase()
          : null,
      vdjPath: typeof o.vdjPath === "string" ? o.vdjPath : undefined,
      r2Url: typeof o.r2Url === "string" ? o.r2Url : undefined,
      note: typeof o.note === "string" ? o.note : undefined,
    });
    return NextResponse.json({ ok: true, action });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
