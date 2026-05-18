import { NextResponse } from "next/server";

import { resolveLegacyPlayback } from "@/lib/legacy-playback/resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Legacy playback bridge (music-browser resolver).
 *
 * GET /api/playback/resolve?artist=Elton%20John&title=Don't%20Let%20the%20Sun%20Go%20Down%20on%20Me
 * GET /api/playback/resolve?rvtr=RVTR000001
 *
 * Returns R2/local → YouTube → search resolution + play-button state.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const artist = url.searchParams.get("artist")?.trim() ?? "";
  const title = url.searchParams.get("title")?.trim() ?? "";
  const rvtr = url.searchParams.get("rvtr")?.trim() ?? "";

  if (!rvtr && (!artist || !title)) {
    return NextResponse.json(
      { ok: false, error: "provide artist+title or rvtr" },
      { status: 400 },
    );
  }

  try {
    const result = await resolveLegacyPlayback({ artist, title, rvtr });
    return NextResponse.json({
      ok: true,
      ...result,
      /** Convenience alias for clients */
      playableUrl: result.target.url,
      r2Available: result.sourceType === "local",
    });
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : typeof e === "object" && e !== null && "message" in e
          ? String((e as { message: unknown }).message)
          : String(e);
    const status =
      message === "artist_and_title_required"
        ? 400
        : message === "invalid_rvtr"
          ? 400
          : message === "rvtr_not_found"
            ? 404
            : message.includes("ENOENT") || message.includes("Cannot open")
              ? 503
              : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
