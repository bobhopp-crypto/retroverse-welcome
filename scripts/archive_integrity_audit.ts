import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { getAllEras } from "@/lib/eras";

const AUDIT_LOG_ROOT =
  process.env.RETROVERSE_AUDIT_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/archive-integrity";
const WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  release_year: number | null;
  era_id: string | null;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
  is_primary?: boolean;
  release_year: number | null;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
  disc_number: number;
  track_number: number;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  retroverse_album_id: string | null;
  era_id: string | null;
  release_year: number | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
  display_name: string;
};

type ArtworkRow = {
  retroverse_album_id: string;
  canonical_cover_path: string | null;
  is_primary?: boolean;
  artwork_role?: string;
};

type MediaAssetRow = {
  retroverse_track_id: string;
  thumbnail_path: string | null;
  is_primary?: boolean;
};

type SourceMatchRow = {
  retroverse_entity_type: "artist" | "album" | "track" | "era";
  retroverse_entity_id: string;
  source_key: string;
};

function runId(): string {
  return `archive_integrity_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function decadeLabel(year: number | null): string {
  if (year === null) return "unknown";
  const start = Math.floor(year / 10) * 10;
  return `${start}s`;
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before audit.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [
    albumsResult,
    editionsWithPrimaryResult,
    albumTracksResult,
    tracksResult,
    artistsResult,
    erasResult,
    artworkWithPrimaryResult,
    mediaWithPrimaryResult,
    sourceMatchesResult,
    albumRolesResult,
  ] = await Promise.all([
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, release_year, era_id"),
    supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id, is_primary, release_year"),
    supabase
      .from("retroverse_album_tracks")
      .select("retroverse_album_edition_id, retroverse_track_id, disc_number, track_number"),
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, era_id, release_year"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase.from("retroverse_eras").select("retroverse_era_id, slug, display_name"),
    supabase.from("retroverse_album_artwork").select("retroverse_album_id, canonical_cover_path, is_primary, artwork_role"),
    supabase.from("retroverse_media_assets").select("retroverse_track_id, thumbnail_path, is_primary"),
    supabase.from("retroverse_source_matches").select("retroverse_entity_type, retroverse_entity_id, source_key"),
    supabase.from("retroverse_album_artist_roles").select("retroverse_album_id, retroverse_artist_id"),
  ]);

  for (const result of [
    albumsResult,
    albumTracksResult,
    tracksResult,
    artistsResult,
    erasResult,
    sourceMatchesResult,
    albumRolesResult,
  ]) {
    if (result.error) throw result.error;
  }

  const editionsFallbackResult =
    editionsWithPrimaryResult.error && editionsWithPrimaryResult.error.code === "42703"
      ? await supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id, release_year")
      : null;
  if (editionsWithPrimaryResult.error && !editionsFallbackResult) throw editionsWithPrimaryResult.error;
  if (editionsFallbackResult?.error) throw editionsFallbackResult.error;

  const artworkFallbackResult =
    artworkWithPrimaryResult.error && artworkWithPrimaryResult.error.code === "42703"
      ? await supabase.from("retroverse_album_artwork").select("retroverse_album_id, canonical_cover_path, artwork_role")
      : null;
  if (artworkWithPrimaryResult.error && !artworkFallbackResult) throw artworkWithPrimaryResult.error;
  if (artworkFallbackResult?.error) throw artworkFallbackResult.error;

  const mediaFallbackResult =
    mediaWithPrimaryResult.error && mediaWithPrimaryResult.error.code === "42703"
      ? await supabase.from("retroverse_media_assets").select("retroverse_track_id, thumbnail_path")
      : null;
  if (mediaWithPrimaryResult.error && !mediaFallbackResult) throw mediaWithPrimaryResult.error;
  if (mediaFallbackResult?.error) throw mediaFallbackResult.error;

  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const editions = ((editionsFallbackResult?.data ?? editionsWithPrimaryResult.data ?? []) as EditionRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? false,
  }));
  const albumTracks = (albumTracksResult.data ?? []) as AlbumTrackRow[];
  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const artists = (artistsResult.data ?? []) as ArtistRow[];
  const eras = (erasResult.data ?? []) as EraRow[];
  const artworkRows = ((artworkFallbackResult?.data ?? artworkWithPrimaryResult.data ?? []) as ArtworkRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? row.artwork_role === "primary",
  }));
  const mediaRows = ((mediaFallbackResult?.data ?? mediaWithPrimaryResult.data ?? []) as MediaAssetRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? false,
  }));
  const sourceMatches = (sourceMatchesResult.data ?? []) as SourceMatchRow[];
  const albumRoles = albumRolesResult.data ?? [];

  const albumById = new Map(albums.map((row) => [row.retroverse_album_id, row]));
  const trackById = new Map(tracks.map((row) => [row.retroverse_track_id, row]));
  const artistById = new Map(artists.map((row) => [row.retroverse_artist_id, row]));
  const eraById = new Map(eras.map((row) => [row.retroverse_era_id, row]));

  // 1) Sequencing integrity
  const editionIdsByAlbumId = new Map<string, string[]>();
  const primaryEditionIdsByAlbumId = new Map<string, string[]>();
  for (const edition of editions) {
    editionIdsByAlbumId.set(edition.retroverse_album_id, [...(editionIdsByAlbumId.get(edition.retroverse_album_id) ?? []), edition.retroverse_album_edition_id]);
    if (edition.is_primary) {
      primaryEditionIdsByAlbumId.set(
        edition.retroverse_album_id,
        [...(primaryEditionIdsByAlbumId.get(edition.retroverse_album_id) ?? []), edition.retroverse_album_edition_id],
      );
    }
  }

  const sequencedTrackIdsByEditionId = new Map<string, Set<string>>();
  for (const row of albumTracks) {
    const current = sequencedTrackIdsByEditionId.get(row.retroverse_album_edition_id) ?? new Set<string>();
    current.add(row.retroverse_track_id);
    sequencedTrackIdsByEditionId.set(row.retroverse_album_edition_id, current);
  }

  const directTrackIdsByAlbumId = new Map<string, Set<string>>();
  for (const track of tracks) {
    if (!track.retroverse_album_id) continue;
    const current = directTrackIdsByAlbumId.get(track.retroverse_album_id) ?? new Set<string>();
    current.add(track.retroverse_track_id);
    directTrackIdsByAlbumId.set(track.retroverse_album_id, current);
  }

  const sequencingCategories = {
    authoritative: [] as string[],
    fallback: [] as string[],
    partial: [] as string[],
    no_usable: [] as string[],
  };
  const sequencingExamples: Array<{
    album_id: string;
    title: string;
    category: keyof typeof sequencingCategories;
    direct_tracks: number;
    primary_seq_tracks: number;
    any_seq_tracks: number;
  }> = [];

  for (const album of albums) {
    const directCount = directTrackIdsByAlbumId.get(album.retroverse_album_id)?.size ?? 0;
    const primaryIds = primaryEditionIdsByAlbumId.get(album.retroverse_album_id) ?? [];
    const allEditionIds = editionIdsByAlbumId.get(album.retroverse_album_id) ?? [];
    const primarySeqCount = [...new Set(primaryIds.flatMap((id) => [...(sequencedTrackIdsByEditionId.get(id) ?? new Set<string>())]))].length;
    const anySeqCount = [...new Set(allEditionIds.flatMap((id) => [...(sequencedTrackIdsByEditionId.get(id) ?? new Set<string>())]))].length;

    let category: keyof typeof sequencingCategories;
    if (primarySeqCount > 0 && (directCount === 0 || primarySeqCount >= directCount)) {
      category = "authoritative";
    } else if (primarySeqCount > 0) {
      category = "partial";
    } else if (anySeqCount > 0 && directCount > 0 && anySeqCount < directCount) {
      category = "partial";
    } else if (anySeqCount > 0 || directCount > 0) {
      category = "fallback";
    } else {
      category = "no_usable";
    }
    sequencingCategories[category].push(album.retroverse_album_id);

    if (category !== "authoritative") {
      sequencingExamples.push({
        album_id: album.retroverse_album_id,
        title: album.canonical_album_title,
        category,
        direct_tracks: directCount,
        primary_seq_tracks: primarySeqCount,
        any_seq_tracks: anySeqCount,
      });
    }
  }

  // 2) Artwork integrity
  const artworkByAlbumId = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    artworkByAlbumId.set(row.retroverse_album_id, [...(artworkByAlbumId.get(row.retroverse_album_id) ?? []), row]);
  }

  const mediaThumbByTrackId = new Map<string, string[]>();
  for (const row of mediaRows) {
    if (!row.thumbnail_path) continue;
    mediaThumbByTrackId.set(row.retroverse_track_id, [...(mediaThumbByTrackId.get(row.retroverse_track_id) ?? []), row.thumbnail_path]);
  }

  const artworkStatusByAlbumId = new Map<string, "canonical" | "fallback" | "broken" | "missing">();
  const brokenArtworkExamples: Array<{ album_id: string; title: string; path: string }> = [];
  const missingArtworkExamples: Array<{ album_id: string; title: string }> = [];

  for (const album of albums) {
    const rows = artworkByAlbumId.get(album.retroverse_album_id) ?? [];
    const canonicalCandidate =
      rows.find((row) => row.is_primary && row.canonical_cover_path) ??
      rows.find((row) => row.artwork_role === "primary" && row.canonical_cover_path) ??
      rows.find((row) => row.canonical_cover_path);

    if (canonicalCandidate?.canonical_cover_path) {
      const coverPath = canonicalCandidate.canonical_cover_path.trim();
      const localPath = coverPath.startsWith("http://") || coverPath.startsWith("https://")
        ? null
        : path.join(WORKSPACE_ROOT, coverPath.replace(/^\/+/, ""));
      if (localPath && !(await fileExists(localPath))) {
        artworkStatusByAlbumId.set(album.retroverse_album_id, "broken");
        brokenArtworkExamples.push({ album_id: album.retroverse_album_id, title: album.canonical_album_title, path: coverPath });
      } else {
        artworkStatusByAlbumId.set(album.retroverse_album_id, "canonical");
      }
      continue;
    }

    const directTrackIds = directTrackIdsByAlbumId.get(album.retroverse_album_id) ?? new Set<string>();
    const editionIds = editionIdsByAlbumId.get(album.retroverse_album_id) ?? [];
    const sequencedTrackIds = new Set<string>(
      editionIds.flatMap((id) => [...(sequencedTrackIdsByEditionId.get(id) ?? new Set<string>())]),
    );
    const candidateTrackIds = new Set<string>([...directTrackIds, ...sequencedTrackIds]);
    const hasFallbackThumb = [...candidateTrackIds].some((trackId) => (mediaThumbByTrackId.get(trackId)?.length ?? 0) > 0);

    if (hasFallbackThumb) {
      artworkStatusByAlbumId.set(album.retroverse_album_id, "fallback");
    } else {
      artworkStatusByAlbumId.set(album.retroverse_album_id, "missing");
      missingArtworkExamples.push({ album_id: album.retroverse_album_id, title: album.canonical_album_title });
    }
  }

  const artworkCounts = {
    canonical: [...artworkStatusByAlbumId.values()].filter((row) => row === "canonical").length,
    fallback: [...artworkStatusByAlbumId.values()].filter((row) => row === "fallback").length,
    broken: [...artworkStatusByAlbumId.values()].filter((row) => row === "broken").length,
    missing: [...artworkStatusByAlbumId.values()].filter((row) => row === "missing").length,
  };

  const artworkByDecade = new Map<string, { total: number; canonical: number; fallback: number; broken: number; missing: number }>();
  const artworkByEra = new Map<string, { total: number; canonical: number; fallback: number; broken: number; missing: number }>();
  for (const album of albums) {
    const status = artworkStatusByAlbumId.get(album.retroverse_album_id) ?? "missing";
    const decade = decadeLabel(album.release_year);
    const eraLabel = album.era_id ? (eraById.get(album.era_id)?.display_name ?? album.era_id) : "unassigned";

    const decadeStats = artworkByDecade.get(decade) ?? { total: 0, canonical: 0, fallback: 0, broken: 0, missing: 0 };
    decadeStats.total += 1;
    decadeStats[status] += 1;
    artworkByDecade.set(decade, decadeStats);

    const eraStats = artworkByEra.get(eraLabel) ?? { total: 0, canonical: 0, fallback: 0, broken: 0, missing: 0 };
    eraStats.total += 1;
    eraStats[status] += 1;
    artworkByEra.set(eraLabel, eraStats);
  }

  // 3) Traversal integrity
  const albumIdsByArtistId = new Map<string, Set<string>>();
  for (const role of albumRoles) {
    const set = albumIdsByArtistId.get(role.retroverse_artist_id) ?? new Set<string>();
    set.add(role.retroverse_album_id);
    albumIdsByArtistId.set(role.retroverse_artist_id, set);
  }
  for (const track of tracks) {
    if (!track.retroverse_album_id) continue;
    const set = albumIdsByArtistId.get(track.retroverse_artist_id) ?? new Set<string>();
    set.add(track.retroverse_album_id);
    albumIdsByArtistId.set(track.retroverse_artist_id, set);
  }
  const artistsWithConnectedAlbums = artists.filter((row) => (albumIdsByArtistId.get(row.retroverse_artist_id)?.size ?? 0) > 0);
  const albumsWithConnectedTracks = albums.filter((row) => {
    const direct = directTrackIdsByAlbumId.get(row.retroverse_album_id)?.size ?? 0;
    const editionIds = editionIdsByAlbumId.get(row.retroverse_album_id) ?? [];
    const sequenced = [...new Set(editionIds.flatMap((id) => [...(sequencedTrackIdsByEditionId.get(id) ?? new Set<string>())]))].length;
    return direct > 0 || sequenced > 0;
  });
  const tracksWithConnectedEras = tracks.filter((row) => row.era_id !== null);
  const orphanedEntities = {
    artists_without_albums: artists
      .filter((row) => (albumIdsByArtistId.get(row.retroverse_artist_id)?.size ?? 0) === 0)
      .slice(0, 25)
      .map((row) => ({ id: row.retroverse_artist_id, name: row.canonical_artist_name })),
    albums_without_tracks: albums
      .filter((row) => {
        const direct = directTrackIdsByAlbumId.get(row.retroverse_album_id)?.size ?? 0;
        const editionIds = editionIdsByAlbumId.get(row.retroverse_album_id) ?? [];
        const sequenced = [...new Set(editionIds.flatMap((id) => [...(sequencedTrackIdsByEditionId.get(id) ?? new Set<string>())]))].length;
        return direct === 0 && sequenced === 0;
      })
      .slice(0, 25)
      .map((row) => ({ id: row.retroverse_album_id, title: row.canonical_album_title })),
    tracks_without_album_or_era: tracks
      .filter((row) => row.retroverse_album_id === null && row.era_id === null)
      .slice(0, 25)
      .map((row) => ({ id: row.retroverse_track_id, title: row.canonical_title })),
  };

  // 4) Canonical confidence
  const duplicateLikeArtists = new Map<string, string[]>();
  for (const artist of artists) {
    const key = normalizeText(artist.canonical_artist_name);
    duplicateLikeArtists.set(key, [...(duplicateLikeArtists.get(key) ?? []), artist.retroverse_artist_id]);
  }
  const duplicateLikeAlbums = new Map<string, string[]>();
  for (const album of albums) {
    const key = normalizeText(album.canonical_album_title);
    duplicateLikeAlbums.set(key, [...(duplicateLikeAlbums.get(key) ?? []), album.retroverse_album_id]);
  }
  const duplicateLikeTracks = new Map<string, string[]>();
  for (const track of tracks) {
    const artistName = artistById.get(track.retroverse_artist_id)?.canonical_artist_name ?? track.retroverse_artist_id;
    const key = `${normalizeText(track.canonical_title)}::${normalizeText(artistName)}`;
    duplicateLikeTracks.set(key, [...(duplicateLikeTracks.get(key) ?? []), track.retroverse_track_id]);
  }

  const weakSlugMatches: Array<{ entity_type: string; entity_id: string; source_key: string; expected_slug: string }> = [];
  for (const match of sourceMatches) {
    const sourceSlug = match.source_key.split("::").pop()?.trim().toLowerCase() ?? "";
    if (!sourceSlug) continue;
    if (match.retroverse_entity_type === "artist") {
      const artist = artistById.get(match.retroverse_entity_id);
      if (!artist) continue;
      const expected = normalizeSlug(artist.canonical_artist_name);
      if (sourceSlug !== expected) weakSlugMatches.push({ entity_type: "artist", entity_id: match.retroverse_entity_id, source_key: match.source_key, expected_slug: expected });
    } else if (match.retroverse_entity_type === "album") {
      const album = albumById.get(match.retroverse_entity_id);
      if (!album) continue;
      const expected = normalizeSlug(album.canonical_album_title);
      if (sourceSlug !== expected) weakSlugMatches.push({ entity_type: "album", entity_id: match.retroverse_entity_id, source_key: match.source_key, expected_slug: expected });
    } else if (match.retroverse_entity_type === "track") {
      const track = trackById.get(match.retroverse_entity_id);
      if (!track) continue;
      const expected = normalizeSlug(track.canonical_title);
      if (sourceSlug !== expected) weakSlugMatches.push({ entity_type: "track", entity_id: match.retroverse_entity_id, source_key: match.source_key, expected_slug: expected });
    }
  }

  const eraDocs = getAllEras();
  const artistNameSet = new Set(artists.map((row) => normalizeText(row.canonical_artist_name)));
  const albumTitleSet = new Set(albums.map((row) => normalizeText(row.canonical_album_title)));
  const trackTitleSet = new Set(tracks.map((row) => normalizeText(row.canonical_title)));

  let unresolvedEraArtistRefs = 0;
  let unresolvedEraAlbumRefs = 0;
  let unresolvedEraSongRefs = 0;
  const unresolvedEraExamples: Array<{ era: string; type: "artist" | "album" | "song"; value: string }> = [];
  const noisyEraStrings: Array<{ era: string; value: string }> = [];
  const noisyRegex = /(usage guidelines|for collectible|for navigation|for search|for editorial|for future ai|maintenance notes)/i;

  for (const era of eraDocs) {
    const artistTokens = era.sections.definingArtists
      .split(",")
      .map((row) => row.trim())
      .filter((row) => row.length > 0);
    for (const token of artistTokens) {
      if (!artistNameSet.has(normalizeText(token))) {
        unresolvedEraArtistRefs += 1;
        if (unresolvedEraExamples.length < 20) unresolvedEraExamples.push({ era: era.slug, type: "artist", value: token });
      }
      if (noisyRegex.test(token)) {
        noisyEraStrings.push({ era: era.slug, value: token });
      }
    }

    for (const album of era.definingAlbums ?? []) {
      if (!albumTitleSet.has(normalizeText(album))) {
        unresolvedEraAlbumRefs += 1;
        if (unresolvedEraExamples.length < 20) unresolvedEraExamples.push({ era: era.slug, type: "album", value: album });
      }
      if (noisyRegex.test(album)) {
        noisyEraStrings.push({ era: era.slug, value: album });
      }
    }

    for (const song of era.definingSongs ?? []) {
      if (!trackTitleSet.has(normalizeText(song))) {
        unresolvedEraSongRefs += 1;
        if (unresolvedEraExamples.length < 20) unresolvedEraExamples.push({ era: era.slug, type: "song", value: song });
      }
      if (noisyRegex.test(song)) {
        noisyEraStrings.push({ era: era.slug, value: song });
      }
    }
  }

  const albumIdsByEditionId = new Map(editions.map((row) => [row.retroverse_album_edition_id, row.retroverse_album_id]));
  const albumIdsByTrackId = new Map<string, Set<string>>();
  for (const row of albumTracks) {
    const albumId = albumIdsByEditionId.get(row.retroverse_album_edition_id);
    if (!albumId) continue;
    const set = albumIdsByTrackId.get(row.retroverse_track_id) ?? new Set<string>();
    set.add(albumId);
    albumIdsByTrackId.set(row.retroverse_track_id, set);
  }
  const ambiguousAlbumRelationships = [...albumIdsByTrackId.entries()]
    .filter(([, albumIds]) => albumIds.size > 1)
    .map(([trackId, albumIds]) => ({
      track_id: trackId,
      title: trackById.get(trackId)?.canonical_title ?? "Unknown track",
      album_count: albumIds.size,
      album_ids: [...albumIds],
    }))
    .sort((a, b) => b.album_count - a.album_count)
    .slice(0, 25);

  const summary = {
    generated_at: new Date().toISOString(),
    counts: {
      artists: artists.length,
      albums: albums.length,
      tracks: tracks.length,
      eras: eras.length,
    },
    sequencing_integrity: {
      authoritative: {
        count: sequencingCategories.authoritative.length,
        pct: pct(sequencingCategories.authoritative.length, albums.length),
      },
      fallback: {
        count: sequencingCategories.fallback.length,
        pct: pct(sequencingCategories.fallback.length, albums.length),
      },
      partial: {
        count: sequencingCategories.partial.length,
        pct: pct(sequencingCategories.partial.length, albums.length),
      },
      no_usable: {
        count: sequencingCategories.no_usable.length,
        pct: pct(sequencingCategories.no_usable.length, albums.length),
      },
      weak_examples: sequencingExamples.slice(0, 20),
    },
    artwork_integrity: {
      canonical: { count: artworkCounts.canonical, pct: pct(artworkCounts.canonical, albums.length) },
      fallback: { count: artworkCounts.fallback, pct: pct(artworkCounts.fallback, albums.length) },
      broken: { count: artworkCounts.broken, pct: pct(artworkCounts.broken, albums.length) },
      missing: { count: artworkCounts.missing, pct: pct(artworkCounts.missing, albums.length) },
      by_decade: [...artworkByDecade.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([decade, stats]) => ({
        decade,
        ...stats,
        canonical_pct: pct(stats.canonical, stats.total),
      })),
      by_era: [...artworkByEra.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([era, stats]) => ({
        era,
        ...stats,
        canonical_pct: pct(stats.canonical, stats.total),
      })),
      broken_examples: brokenArtworkExamples.slice(0, 20),
      missing_examples: missingArtworkExamples.slice(0, 20),
    },
    traversal_integrity: {
      artists_with_connected_albums: {
        count: artistsWithConnectedAlbums.length,
        pct: pct(artistsWithConnectedAlbums.length, artists.length),
      },
      albums_with_connected_tracks: {
        count: albumsWithConnectedTracks.length,
        pct: pct(albumsWithConnectedTracks.length, albums.length),
      },
      tracks_with_connected_eras: {
        count: tracksWithConnectedEras.length,
        pct: pct(tracksWithConnectedEras.length, tracks.length),
      },
      orphaned_entities: orphanedEntities,
    },
    canonical_confidence: {
      duplicate_like_entities: {
        artists: [...duplicateLikeArtists.entries()].filter(([, ids]) => ids.length > 1).slice(0, 20),
        albums: [...duplicateLikeAlbums.entries()].filter(([, ids]) => ids.length > 1).slice(0, 20),
        tracks: [...duplicateLikeTracks.entries()].filter(([, ids]) => ids.length > 1).slice(0, 20),
      },
      weak_slug_matches: {
        count: weakSlugMatches.length,
        examples: weakSlugMatches.slice(0, 30),
      },
      unresolved_era_references: {
        artists: unresolvedEraArtistRefs,
        albums: unresolvedEraAlbumRefs,
        songs: unresolvedEraSongRefs,
        examples: unresolvedEraExamples,
      },
      noisy_era_strings: {
        count: noisyEraStrings.length,
        examples: noisyEraStrings.slice(0, 30),
      },
      ambiguous_album_relationships: {
        count: ambiguousAlbumRelationships.length,
        examples: ambiguousAlbumRelationships,
      },
    },
    top_problem_categories: [
      { key: "missing_or_broken_artwork", count: artworkCounts.missing + artworkCounts.broken },
      { key: "non_authoritative_or_partial_sequencing", count: sequencingCategories.partial.length + sequencingCategories.fallback.length + sequencingCategories.no_usable.length },
      { key: "weak_slug_matches", count: weakSlugMatches.length },
      { key: "unresolved_era_references", count: unresolvedEraArtistRefs + unresolvedEraAlbumRefs + unresolvedEraSongRefs },
    ].sort((a, b) => b.count - a.count),
  };

  const id = runId();
  await mkdir(AUDIT_LOG_ROOT, { recursive: true });
  const jsonPath = path.join(AUDIT_LOG_ROOT, `${id}.json`);
  const mdPath = path.join(AUDIT_LOG_ROOT, `${id}.md`);
  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const md = [
    `# Retroverse Archive Integrity ${id}`,
    "",
    `Generated: ${summary.generated_at}`,
    "",
    "## Sequencing Integrity",
    `- authoritative: ${summary.sequencing_integrity.authoritative.count} (${summary.sequencing_integrity.authoritative.pct}%)`,
    `- fallback: ${summary.sequencing_integrity.fallback.count} (${summary.sequencing_integrity.fallback.pct}%)`,
    `- partial: ${summary.sequencing_integrity.partial.count} (${summary.sequencing_integrity.partial.pct}%)`,
    `- no usable: ${summary.sequencing_integrity.no_usable.count} (${summary.sequencing_integrity.no_usable.pct}%)`,
    "",
    "## Artwork Integrity",
    `- canonical: ${summary.artwork_integrity.canonical.count} (${summary.artwork_integrity.canonical.pct}%)`,
    `- fallback: ${summary.artwork_integrity.fallback.count} (${summary.artwork_integrity.fallback.pct}%)`,
    `- broken: ${summary.artwork_integrity.broken.count} (${summary.artwork_integrity.broken.pct}%)`,
    `- missing: ${summary.artwork_integrity.missing.count} (${summary.artwork_integrity.missing.pct}%)`,
    "",
    "## Traversal Integrity",
    `- artists with connected albums: ${summary.traversal_integrity.artists_with_connected_albums.count} (${summary.traversal_integrity.artists_with_connected_albums.pct}%)`,
    `- albums with connected tracks: ${summary.traversal_integrity.albums_with_connected_tracks.count} (${summary.traversal_integrity.albums_with_connected_tracks.pct}%)`,
    `- tracks with connected eras: ${summary.traversal_integrity.tracks_with_connected_eras.count} (${summary.traversal_integrity.tracks_with_connected_eras.pct}%)`,
    "",
    "## Canonical Confidence",
    `- weak slug matches: ${summary.canonical_confidence.weak_slug_matches.count}`,
    `- unresolved era refs: ${
      summary.canonical_confidence.unresolved_era_references.artists +
      summary.canonical_confidence.unresolved_era_references.albums +
      summary.canonical_confidence.unresolved_era_references.songs
    }`,
    `- noisy era strings: ${summary.canonical_confidence.noisy_era_strings.count}`,
    `- ambiguous album relationships (sample): ${summary.canonical_confidence.ambiguous_album_relationships.count}`,
    "",
    "## Top Problem Categories",
    ...summary.top_problem_categories.map((row) => `- ${row.key}: ${row.count}`),
    "",
    `JSON report: ${jsonPath}`,
  ].join("\n");
  await writeFile(mdPath, `${md}\n`, "utf8");

  console.log(`archive_audit_json=${jsonPath}`);
  console.log(`archive_audit_md=${mdPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(message);
  process.exitCode = 1;
});
