import { NextResponse } from "next/server";

import { isDiscoverReviewMark, upsertDiscoverReviewMark, type DiscoverReviewMark } from "@/lib/discover-review-state";

const RVAL = /^RVAL[0-9]{6}$/i;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const rec = body as { albumId?: string; state?: string };
  const albumId = (rec.albumId ?? "").trim().toUpperCase();
  const state = (rec.state ?? "").trim();
  if (!RVAL.test(albumId) || !isDiscoverReviewMark(state)) {
    return NextResponse.json({ error: "invalid albumId or state" }, { status: 400 });
  }
  try {
    await upsertDiscoverReviewMark(albumId, state as DiscoverReviewMark);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[discover/review-state]", e);
    return NextResponse.json({ error: "write failed" }, { status: 500 });
  }
}
