import { NextResponse } from "next/server";

import { checkPlaybackForFile } from "@/lib/relationship-workspace/playback-check";
import { classifyVdjPath, isVideoExtension } from "@/lib/relationship-workspace/vdj-media";
import { upsertTrackLink } from "@/lib/track-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const o = body as Record<string, unknown>;
  const chartArtist = typeof o.chartArtist === "string" ? o.chartArtist.trim() : "";
  const chartTitle = typeof o.chartTitle === "string" ? o.chartTitle.trim() : "";
  const vdjPath = typeof o.vdjPath === "string" ? o.vdjPath.trim() : "";

  if (!chartArtist || !chartTitle || !vdjPath) {
    return NextResponse.json({ ok: false, error: "chart_and_vdj_required" }, { status: 400 });
  }

  if (!isVideoExtension(vdjPath) || classifyVdjPath(vdjPath) !== "video") {
    return NextResponse.json({ ok: false, error: "video_file_required" }, { status: 400 });
  }

  const chartWeek = typeof o.chartWeek === "string" ? o.chartWeek.trim() || null : null;
  const chartRankRaw = typeof o.chartRank === "number" ? o.chartRank : Number.parseInt(String(o.chartRank ?? ""), 10);
  const chartRank = Number.isFinite(chartRankRaw) ? chartRankRaw : null;

  let r2Url = typeof o.r2Url === "string" && o.r2Url.trim() ? o.r2Url.trim() : null;
  if (!r2Url) {
    const playback = await checkPlaybackForFile({
      chartArtist,
      chartTitle,
      vdjFilePath: vdjPath,
    });
    r2Url = playback.playUrl;
  }

  try {
    const link = await upsertTrackLink({
      chartArtist,
      chartTitle,
      chartWeek,
      chartRank,
      vdjPath,
      r2Url,
    });
    return NextResponse.json({ ok: true, link });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
