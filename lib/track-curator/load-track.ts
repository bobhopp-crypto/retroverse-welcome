import { createClient } from "@/lib/supabase";

const RVTR_RE = /^RVTR[0-9]{6}$/i;

export type ChartTrackContext = {
  retroverseTrackId: string | null;
  title: string;
  artist: string;
};

export async function loadChartTrackContext(opts: {
  rvtr?: string;
  artist?: string;
  title?: string;
}): Promise<ChartTrackContext | null> {
  const rvtr = opts.rvtr?.trim().toUpperCase();
  if (rvtr && RVTR_RE.test(rvtr)) {
    const supabase = createClient();
    const trackResult = await supabase
      .from("retroverse_tracks")
      .select("canonical_title, retroverse_artist_id, retroverse_track_id")
      .eq("retroverse_track_id", rvtr)
      .limit(1)
      .maybeSingle();

    if (trackResult.error) throw trackResult.error;
    if (trackResult.data) {
      const artistResult = await supabase
        .from("retroverse_artists")
        .select("canonical_artist_name")
        .eq("retroverse_artist_id", trackResult.data.retroverse_artist_id)
        .limit(1)
        .maybeSingle();
      if (artistResult.error) throw artistResult.error;
      return {
        retroverseTrackId: trackResult.data.retroverse_track_id,
        title: (trackResult.data.canonical_title ?? "").trim(),
        artist: (artistResult.data?.canonical_artist_name ?? "").trim() || "—",
      };
    }
  }

  const artist = opts.artist?.trim() ?? "";
  const title = opts.title?.trim() ?? "";
  if (artist && title) {
    return {
      retroverseTrackId: rvtr && RVTR_RE.test(rvtr) ? rvtr : null,
      artist,
      title,
    };
  }

  return null;
}
