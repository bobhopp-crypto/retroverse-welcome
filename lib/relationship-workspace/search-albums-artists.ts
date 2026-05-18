import { createClient } from "@/lib/supabase";

import { fuzzyScoreParts } from "./fuzzy";
import type { AlbumPanelEntry, ArtistPanelEntry } from "./types";

export async function searchAlbumPlacements(input: {
  artist: string;
  title: string;
  limit?: number;
}): Promise<AlbumPanelEntry[]> {
  const supabase = createClient();
  const titleNeedle = input.title.trim().slice(0, 48).replace(/[%_]/g, "");

  const tracksResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title, retroverse_album_id, retroverse_artist_id, release_year")
    .not("retroverse_album_id", "is", null)
    .ilike("canonical_title", `%${titleNeedle}%`)
    .limit(30);

  if (tracksResult.error) throw tracksResult.error;
  const tracks = (tracksResult.data ?? []).filter((t) => t.retroverse_album_id);
  if (!tracks.length) return [];

  const albumIds = [...new Set(tracks.map((t) => t.retroverse_album_id!))];
  const artistIds = [...new Set(tracks.map((t) => t.retroverse_artist_id).filter(Boolean))];

  const [albumsResult, artistsResult] = await Promise.all([
    supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, release_year")
      .in("retroverse_album_id", albumIds),
    supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .in("retroverse_artist_id", artistIds),
  ]);

  if (albumsResult.error) throw albumsResult.error;
  if (artistsResult.error) throw artistsResult.error;

  const albumById = new Map(
    (albumsResult.data ?? []).map((a) => [
      a.retroverse_album_id,
      { title: a.canonical_album_title ?? "—", year: a.release_year ?? null },
    ]),
  );
  const artistById = new Map(
    (artistsResult.data ?? []).map((a) => [a.retroverse_artist_id, a.canonical_artist_name ?? "—"]),
  );

  const scored: AlbumPanelEntry[] = [];
  for (const t of tracks) {
    const album = albumById.get(t.retroverse_album_id!);
    if (!album) continue;
    const artistName = artistById.get(t.retroverse_artist_id) ?? "—";
    const trackTitle = (t.canonical_title ?? "").trim();
    const { score, reason } = fuzzyScoreParts(
      `${artistName} ${trackTitle} ${album.title}`,
      input.artist,
      input.title,
    );
    if (score < 18) continue;
    scored.push({
      retroverseAlbumId: t.retroverse_album_id!,
      albumTitle: album.title,
      artist: artistName,
      releaseYear: t.release_year ?? album.year,
      trackTitle,
      score,
      reason,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, input.limit ?? 16);
}

export async function searchArtistCandidates(input: {
  artist: string;
  limit?: number;
}): Promise<ArtistPanelEntry[]> {
  const supabase = createClient();
  const needle = input.artist.trim().slice(0, 40).replace(/[%_]/g, "");
  if (!needle) return [];

  const result = await supabase
    .from("retroverse_artists")
    .select("retroverse_artist_id, canonical_artist_name")
    .ilike("canonical_artist_name", `%${needle}%`)
    .limit(24);

  if (result.error) throw result.error;

  const scored: ArtistPanelEntry[] = [];
  for (const row of result.data ?? []) {
    const name = (row.canonical_artist_name ?? "").trim();
    const { score, reason } = fuzzyScoreParts(name, input.artist, "");
    if (score < 10) continue;
    scored.push({
      retroverseArtistId: row.retroverse_artist_id,
      canonicalArtistName: name || "—",
      aliases: [],
      score,
      reason,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, input.limit ?? 12);
}
