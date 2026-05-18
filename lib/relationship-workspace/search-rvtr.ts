import { createClient } from "@/lib/supabase";

import { fuzzyScoreParts } from "./fuzzy";
import type { RvtrPanelEntry } from "./types";

const RVTR_RE = /^RVTR[0-9]{6}$/i;

export async function searchRvtrTracks(input: {
  artist: string;
  title: string;
  rvtr?: string | null;
  limit?: number;
}): Promise<RvtrPanelEntry[]> {
  const supabase = createClient();
  const limit = input.limit ?? 16;
  const entries: RvtrPanelEntry[] = [];

  const rvtr = input.rvtr?.trim().toUpperCase();
  if (rvtr && RVTR_RE.test(rvtr)) {
    const trackResult = await supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id")
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
      entries.push({
        retroverseTrackId: trackResult.data.retroverse_track_id,
        canonicalTitle: (trackResult.data.canonical_title ?? "").trim(),
        canonicalArtist: (artistResult.data?.canonical_artist_name ?? "").trim() || "—",
        retroverseArtistId: trackResult.data.retroverse_artist_id,
        confidence: 100,
        reason: "exact RVTR",
      });
      return entries;
    }
  }

  const titleNeedle = input.title.trim().slice(0, 48);
  const trackRows = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title, retroverse_artist_id")
    .ilike("canonical_title", `%${titleNeedle.replace(/[%_]/g, "")}%`)
    .limit(40);

  if (trackRows.error) throw trackRows.error;
  const tracks = trackRows.data ?? [];
  if (!tracks.length) return [];

  const artistIds = [...new Set(tracks.map((t) => t.retroverse_artist_id).filter(Boolean))];
  const artistsResult = await supabase
    .from("retroverse_artists")
    .select("retroverse_artist_id, canonical_artist_name")
    .in("retroverse_artist_id", artistIds);

  if (artistsResult.error) throw artistsResult.error;
  const artistById = new Map(
    (artistsResult.data ?? []).map((a) => [a.retroverse_artist_id, a.canonical_artist_name ?? "—"]),
  );

  const scored: RvtrPanelEntry[] = [];
  for (const t of tracks) {
    const canonicalArtist = artistById.get(t.retroverse_artist_id) ?? "—";
    const canonicalTitle = (t.canonical_title ?? "").trim();
    const { score, reason } = fuzzyScoreParts(
      `${canonicalArtist} ${canonicalTitle}`,
      input.artist,
      input.title,
    );
    if (score < 18) continue;
    scored.push({
      retroverseTrackId: t.retroverse_track_id,
      canonicalTitle,
      canonicalArtist,
      retroverseArtistId: t.retroverse_artist_id,
      confidence: Math.min(99, score),
      reason,
    });
  }

  scored.sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, limit);
}
