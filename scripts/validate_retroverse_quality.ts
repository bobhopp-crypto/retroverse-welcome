import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { generateAlbumPathways, generateArtistPathways, generateEraPathways, generateTrackPathways } from "@/lib/retroverse-pathways";

const VALIDATION_ROOT =
  process.env.RETROVERSE_VALIDATION_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/validation";

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  retroverse_album_id: string | null;
  release_year: number | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  release_year: number | null;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
  release_year: number | null;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
  disc_number: number;
  track_number: number;
};

type ArtworkRow = {
  retroverse_album_id: string;
  canonical_cover_path: string | null;
  is_primary?: boolean;
  artwork_role: string;
};

type EraRow = {
  retroverse_era_id: string;
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function runId(): string {
  return `retroverse_validation_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before validation.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [
    tracksResult,
    artistsResult,
    albumsResult,
    editionsResult,
    albumTracksResult,
    artworkWithPrimaryResult,
    erasResult,
  ] = await Promise.all([
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, release_year"),
    supabase.from("retroverse_album_editions").select("retroverse_album_edition_id, retroverse_album_id, release_year"),
    supabase.from("retroverse_album_tracks").select("retroverse_album_edition_id, retroverse_track_id, disc_number, track_number"),
    supabase.from("retroverse_album_artwork").select("retroverse_album_id, canonical_cover_path, is_primary, artwork_role"),
    supabase.from("retroverse_eras").select("retroverse_era_id"),
  ]);

  for (const result of [tracksResult, artistsResult, albumsResult, editionsResult, albumTracksResult, erasResult]) {
    if (result.error) throw result.error;
  }

  const artworkFallbackResult =
    artworkWithPrimaryResult.error && artworkWithPrimaryResult.error.code === "42703"
      ? await supabase.from("retroverse_album_artwork").select("retroverse_album_id, canonical_cover_path, artwork_role")
      : null;
  if (artworkWithPrimaryResult.error && !artworkFallbackResult) throw artworkWithPrimaryResult.error;
  if (artworkFallbackResult?.error) throw artworkFallbackResult.error;

  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const artists = (artistsResult.data ?? []) as ArtistRow[];
  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const editions = (editionsResult.data ?? []) as EditionRow[];
  const albumTracks = (albumTracksResult.data ?? []) as AlbumTrackRow[];
  const artworkRows = ((artworkFallbackResult?.data ?? artworkWithPrimaryResult.data ?? []) as ArtworkRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? row.artwork_role === "primary",
  }));
  const eras = (erasResult.data ?? []) as EraRow[];

  const artistById = new Map(artists.map((row) => [row.retroverse_artist_id, row]));
  const editionById = new Map(editions.map((row) => [row.retroverse_album_edition_id, row]));
  const albumById = new Map(albums.map((row) => [row.retroverse_album_id, row]));

  const duplicateTracks = new Map<string, string[]>();
  for (const track of tracks) {
    const artistName = artistById.get(track.retroverse_artist_id)?.canonical_artist_name ?? track.retroverse_artist_id;
    const key = `${normalizeText(track.canonical_title)}::${normalizeText(artistName)}`;
    const current = duplicateTracks.get(key) ?? [];
    current.push(track.retroverse_track_id);
    duplicateTracks.set(key, current);
  }
  const duplicateTrackEntries = [...duplicateTracks.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, track_ids: ids }));

  const releaseYearsByTrackId = new Map<string, Set<number>>();
  for (const track of tracks) {
    const years = releaseYearsByTrackId.get(track.retroverse_track_id) ?? new Set<number>();
    if (track.release_year !== null) years.add(track.release_year);
    releaseYearsByTrackId.set(track.retroverse_track_id, years);
  }
  for (const row of albumTracks) {
    const edition = editionById.get(row.retroverse_album_edition_id);
    const album = edition ? albumById.get(edition.retroverse_album_id) : null;
    const years = releaseYearsByTrackId.get(row.retroverse_track_id) ?? new Set<number>();
    if (edition && edition.release_year !== null) years.add(edition.release_year);
    if (album && album.release_year !== null) years.add(album.release_year);
    releaseYearsByTrackId.set(row.retroverse_track_id, years);
  }
  const conflictingReleaseYears = [...releaseYearsByTrackId.entries()]
    .filter(([, years]) => years.size > 1)
    .map(([trackId, years]) => ({ retroverse_track_id: trackId, years: [...years].sort((a, b) => a - b) }));

  const slotConflicts = new Map<string, number>();
  const trackPlacementConflicts = new Map<string, number>();
  for (const row of albumTracks) {
    const slotKey = `${row.retroverse_album_edition_id}::${row.disc_number}::${row.track_number}`;
    slotConflicts.set(slotKey, (slotConflicts.get(slotKey) ?? 0) + 1);
    const trackPlacementKey = `${row.retroverse_album_edition_id}::${row.retroverse_track_id}`;
    trackPlacementConflicts.set(trackPlacementKey, (trackPlacementConflicts.get(trackPlacementKey) ?? 0) + 1);
  }
  const sequencingConflicts = {
    duplicate_slots: [...slotConflicts.entries()].filter(([, count]) => count > 1),
    duplicate_track_placements: [...trackPlacementConflicts.entries()].filter(([, count]) => count > 1),
  };

  const artworkByAlbumId = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    const current = artworkByAlbumId.get(row.retroverse_album_id) ?? [];
    current.push(row);
    artworkByAlbumId.set(row.retroverse_album_id, current);
  }
  const unresolvedArtwork = albums
    .filter((album) => {
      const rows = artworkByAlbumId.get(album.retroverse_album_id) ?? [];
      return !rows.some((row) => row.canonical_cover_path && row.canonical_cover_path.trim().length > 0);
    })
    .map((album) => ({ retroverse_album_id: album.retroverse_album_id, title: album.canonical_album_title }));

  const editionIdsByAlbumId = new Map<string, Set<string>>();
  for (const edition of editions) {
    const current = editionIdsByAlbumId.get(edition.retroverse_album_id) ?? new Set<string>();
    current.add(edition.retroverse_album_edition_id);
    editionIdsByAlbumId.set(edition.retroverse_album_id, current);
  }
  const membershipByTrackId = new Map<string, number>();
  for (const row of albumTracks) {
    membershipByTrackId.set(row.retroverse_track_id, (membershipByTrackId.get(row.retroverse_track_id) ?? 0) + 1);
  }
  const orphaned = {
    tracks_without_album_or_membership: tracks
      .filter((row) => row.retroverse_album_id === null && (membershipByTrackId.get(row.retroverse_track_id) ?? 0) === 0)
      .map((row) => row.retroverse_track_id),
    albums_without_editions: albums
      .filter((row) => (editionIdsByAlbumId.get(row.retroverse_album_id)?.size ?? 0) === 0)
      .map((row) => row.retroverse_album_id),
  };

  const weakPathwayDensity = {
    tracks: [] as Array<{ id: string; pathway_count: number; top_score: number }>,
    albums: [] as Array<{ id: string; pathway_count: number; top_score: number }>,
    artists: [] as Array<{ id: string; pathway_count: number; top_score: number }>,
    eras: [] as Array<{ id: string; pathway_count: number; top_score: number }>,
  };

  for (const row of tracks.slice(0, 40)) {
    const pathways = await generateTrackPathways(supabase, row.retroverse_track_id);
    const topScore = pathways[0]?.score ?? 0;
    if (pathways.length < 2 || topScore < 8) {
      weakPathwayDensity.tracks.push({ id: row.retroverse_track_id, pathway_count: pathways.length, top_score: topScore });
    }
  }
  for (const row of albums.slice(0, 40)) {
    const pathways = await generateAlbumPathways(supabase, row.retroverse_album_id);
    const topScore = pathways[0]?.score ?? 0;
    if (pathways.length < 2 || topScore < 8) {
      weakPathwayDensity.albums.push({ id: row.retroverse_album_id, pathway_count: pathways.length, top_score: topScore });
    }
  }
  for (const row of artists.slice(0, 40)) {
    const pathways = await generateArtistPathways(supabase, row.retroverse_artist_id);
    const topScore = pathways[0]?.score ?? 0;
    if (pathways.length < 2 || topScore < 8) {
      weakPathwayDensity.artists.push({ id: row.retroverse_artist_id, pathway_count: pathways.length, top_score: topScore });
    }
  }
  for (const row of eras.slice(0, 20)) {
    const pathways = await generateEraPathways(supabase, row.retroverse_era_id);
    const topScore = pathways[0]?.score ?? 0;
    if (pathways.length < 2 || topScore < 8) {
      weakPathwayDensity.eras.push({ id: row.retroverse_era_id, pathway_count: pathways.length, top_score: topScore });
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    counts: {
      tracks: tracks.length,
      albums: albums.length,
      artists: artists.length,
      eras: eras.length,
      duplicate_track_groups: duplicateTrackEntries.length,
      conflicting_release_year_tracks: conflictingReleaseYears.length,
      unresolved_artwork_albums: unresolvedArtwork.length,
      orphan_tracks: orphaned.tracks_without_album_or_membership.length,
      orphan_albums: orphaned.albums_without_editions.length,
      weak_pathway_tracks: weakPathwayDensity.tracks.length,
      weak_pathway_albums: weakPathwayDensity.albums.length,
      weak_pathway_artists: weakPathwayDensity.artists.length,
      weak_pathway_eras: weakPathwayDensity.eras.length,
    },
    duplicate_tracks: duplicateTrackEntries,
    conflicting_release_years: conflictingReleaseYears,
    sequencing_conflicts: sequencingConflicts,
    unresolved_artwork: unresolvedArtwork,
    orphaned_entities: orphaned,
    weak_pathway_density: weakPathwayDensity,
  };

  const id = runId();
  await mkdir(VALIDATION_ROOT, { recursive: true });
  const jsonPath = path.join(VALIDATION_ROOT, `${id}.json`);
  const mdPath = path.join(VALIDATION_ROOT, `${id}.md`);
  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const md = [
    `# Retroverse Validation ${id}`,
    "",
    `Generated: ${summary.generated_at}`,
    "",
    "## Counts",
    `- tracks: ${summary.counts.tracks}`,
    `- albums: ${summary.counts.albums}`,
    `- artists: ${summary.counts.artists}`,
    `- eras: ${summary.counts.eras}`,
    `- duplicate track groups: ${summary.counts.duplicate_track_groups}`,
    `- conflicting release-year tracks: ${summary.counts.conflicting_release_year_tracks}`,
    `- unresolved artwork albums: ${summary.counts.unresolved_artwork_albums}`,
    `- orphan tracks: ${summary.counts.orphan_tracks}`,
    `- orphan albums: ${summary.counts.orphan_albums}`,
    `- weak pathway tracks: ${summary.counts.weak_pathway_tracks}`,
    `- weak pathway albums: ${summary.counts.weak_pathway_albums}`,
    `- weak pathway artists: ${summary.counts.weak_pathway_artists}`,
    `- weak pathway eras: ${summary.counts.weak_pathway_eras}`,
    "",
    `JSON report: ${jsonPath}`,
  ].join("\n");

  await writeFile(mdPath, `${md}\n`, "utf8");
  console.log(`validation_json=${jsonPath}`);
  console.log(`validation_md=${mdPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(message);
  process.exitCode = 1;
});
