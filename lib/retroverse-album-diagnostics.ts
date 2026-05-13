import type { createClient } from "@/lib/supabase";

type Supabase = ReturnType<typeof createClient>;

let retroverseAlbumDiagnosticsPrinted = false;

/**
 * Logs aggregate album / artwork / internal track coverage once per server process.
 */
export async function logRetroverseAlbumDiagnosticsOnce(supabase: Supabase): Promise<void> {
  if (retroverseAlbumDiagnosticsPrinted) return;
  retroverseAlbumDiagnosticsPrinted = true;

  try {
    const [albumsCountRes, artworkRes, editionTracksRes, directTracksRes] = await Promise.all([
      supabase.from("retroverse_albums").select("retroverse_album_id", { count: "exact", head: true }),
      supabase
        .from("retroverse_album_artwork")
        .select("retroverse_album_id, canonical_cover_path, artwork_status")
        .not("canonical_cover_path", "is", null),
      supabase
        .from("retroverse_album_tracks")
        .select("retroverse_track_id, retroverse_album_editions!inner(retroverse_album_id)"),
      supabase
        .from("retroverse_tracks")
        .select("retroverse_track_id, retroverse_album_id")
        .not("retroverse_album_id", "is", null),
    ]);

    if (albumsCountRes.error) throw albumsCountRes.error;
    if (artworkRes.error) throw artworkRes.error;
    if (editionTracksRes.error) throw editionTracksRes.error;
    if (directTracksRes.error) throw directTracksRes.error;

    const totalAlbums = albumsCountRes.count ?? 0;

    const coverAlbumIds = new Set<string>();
    for (const row of artworkRes.data ?? []) {
      const id = row.retroverse_album_id as string;
      const path = (row.canonical_cover_path as string | null) ?? "";
      const status = (row.artwork_status as string | null) ?? "";
      if (!id || !path.trim()) continue;
      if (["missing", "rejected"].includes(status)) continue;
      coverAlbumIds.add(id);
    }

    const edgeKeys = new Set<string>();
    const tracklistAlbumIds = new Set<string>();

    for (const row of editionTracksRes.data ?? []) {
      const nested = row.retroverse_album_editions as { retroverse_album_id?: string } | null;
      const al = nested?.retroverse_album_id;
      const tid = row.retroverse_track_id as string | undefined;
      if (al && tid) {
        tracklistAlbumIds.add(al);
        edgeKeys.add(`${al}::${tid}`);
      }
    }
    for (const t of directTracksRes.data ?? []) {
      const al = t.retroverse_album_id as string | null;
      const tid = t.retroverse_track_id as string | null;
      if (al && tid) {
        tracklistAlbumIds.add(al);
        edgeKeys.add(`${al}::${tid}`);
      }
    }

    const uniqueAlbumTrackEdges = edgeKeys.size;
    const withCovers = coverAlbumIds.size;
    const withoutCovers = Math.max(0, totalAlbums - withCovers);
    const withTracks = tracklistAlbumIds.size;
    const withoutTracks = Math.max(0, totalAlbums - withTracks);
    const avgTracksPerAlbum =
      totalAlbums > 0 ? (uniqueAlbumTrackEdges / totalAlbums).toFixed(2) : "0.00";
    const avgTracksWhenHasTracks =
      withTracks > 0 ? (uniqueAlbumTrackEdges / withTracks).toFixed(2) : "0.00";

    console.info(
      [
        "[retroverse:diagnostics] Internal album catalog (once per process)",
        `  albums_total: ${totalAlbums}`,
        `  albums_with_covers: ${withCovers}`,
        `  albums_without_covers: ${withoutCovers}`,
        `  albums_with_tracks: ${withTracks}`,
        `  albums_without_tracks: ${withoutTracks}`,
        `  unique_album_track_links: ${uniqueAlbumTrackEdges}`,
        `  avg_tracks_per_album: ${avgTracksPerAlbum}`,
        `  avg_tracks_per_album_when_has_tracks: ${avgTracksWhenHasTracks}`,
      ].join("\n"),
    );
  } catch (err) {
    console.warn("[retroverse:diagnostics] failed to compute album snapshot:", err);
  }
}
