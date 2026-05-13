import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { getAllEras } from "@/lib/eras";

const ENRICHMENT_LOG_ROOT =
  process.env.RETROVERSE_ENRICHMENT_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/archive-enrichment";
const WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  era_id: string | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  retroverse_album_id: string | null;
  era_id: string | null;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
};

type ArtworkRow = {
  retroverse_album_id: string;
  canonical_cover_path: string | null;
  is_primary?: boolean;
  artwork_role?: string | null;
};

type MediaAssetRow = {
  retroverse_track_id: string;
  thumbnail_path: string | null;
};

type ChartRow = {
  retroverse_track_id: string;
};

type SourceMatchRow = {
  retroverse_source_match_id: string;
  retroverse_entity_type: "artist" | "album" | "track" | "era";
  retroverse_entity_id: string;
  source_key: string;
};

type AlbumArtistRoleRow = {
  retroverse_album_id: string;
  retroverse_artist_id: string;
};

function runId(): string {
  return `archive_enrichment_${new Date().toISOString().replace(/[:.]/g, "-")}`;
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

function tokenSet(value: string): Set<string> {
  return new Set(
    normalizeText(value)
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

function sanitizeEraToken(value: string): string {
  return value
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\.$/, "")
    .trim();
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before enrichment queue generation.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [
    albumsResult,
    artistsResult,
    tracksResult,
    editionsResult,
    albumTracksResult,
    artworkWithPrimaryResult,
    mediaAssetsResult,
    chartRowsResult,
    sourceMatchesResult,
    albumRolesResult,
  ] = await Promise.all([
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, era_id"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase.from("retroverse_tracks").select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, era_id"),
    supabase.from("retroverse_album_editions").select("retroverse_album_edition_id, retroverse_album_id"),
    supabase.from("retroverse_album_tracks").select("retroverse_album_edition_id, retroverse_track_id"),
    supabase.from("retroverse_album_artwork").select("retroverse_album_id, canonical_cover_path, is_primary, artwork_role"),
    supabase.from("retroverse_media_assets").select("retroverse_track_id, thumbnail_path"),
    supabase.from("retroverse_chart_appearances").select("retroverse_track_id"),
    supabase
      .from("retroverse_source_matches")
      .select("retroverse_source_match_id, retroverse_entity_type, retroverse_entity_id, source_key"),
    supabase.from("retroverse_album_artist_roles").select("retroverse_album_id, retroverse_artist_id"),
  ]);

  for (const result of [
    albumsResult,
    artistsResult,
    tracksResult,
    editionsResult,
    albumTracksResult,
    mediaAssetsResult,
    chartRowsResult,
    sourceMatchesResult,
    albumRolesResult,
  ]) {
    if (result.error) throw result.error;
  }

  const artworkFallbackResult =
    artworkWithPrimaryResult.error && artworkWithPrimaryResult.error.code === "42703"
      ? await supabase.from("retroverse_album_artwork").select("retroverse_album_id, canonical_cover_path, artwork_role")
      : null;
  if (artworkWithPrimaryResult.error && !artworkFallbackResult) throw artworkWithPrimaryResult.error;
  if (artworkFallbackResult?.error) throw artworkFallbackResult.error;

  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const artists = (artistsResult.data ?? []) as ArtistRow[];
  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const editions = (editionsResult.data ?? []) as EditionRow[];
  const albumTracks = (albumTracksResult.data ?? []) as AlbumTrackRow[];
  const artworkRows = ((artworkFallbackResult?.data ?? artworkWithPrimaryResult.data ?? []) as ArtworkRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? row.artwork_role === "primary",
  }));
  const mediaAssets = (mediaAssetsResult.data ?? []) as MediaAssetRow[];
  const chartRows = (chartRowsResult.data ?? []) as ChartRow[];
  const sourceMatches = (sourceMatchesResult.data ?? []) as SourceMatchRow[];
  const albumRoles = (albumRolesResult.data ?? []) as AlbumArtistRoleRow[];

  const albumById = new Map(albums.map((row) => [row.retroverse_album_id, row]));
  const artistById = new Map(artists.map((row) => [row.retroverse_artist_id, row]));
  const trackById = new Map(tracks.map((row) => [row.retroverse_track_id, row]));
  const editionById = new Map(editions.map((row) => [row.retroverse_album_edition_id, row.retroverse_album_id]));

  const directTrackIdsByAlbumId = new Map<string, Set<string>>();
  for (const track of tracks) {
    if (!track.retroverse_album_id) continue;
    const set = directTrackIdsByAlbumId.get(track.retroverse_album_id) ?? new Set<string>();
    set.add(track.retroverse_track_id);
    directTrackIdsByAlbumId.set(track.retroverse_album_id, set);
  }

  const sequencedTrackIdsByAlbumId = new Map<string, Set<string>>();
  for (const row of albumTracks) {
    const albumId = editionById.get(row.retroverse_album_edition_id);
    if (!albumId) continue;
    const set = sequencedTrackIdsByAlbumId.get(albumId) ?? new Set<string>();
    set.add(row.retroverse_track_id);
    sequencedTrackIdsByAlbumId.set(albumId, set);
  }

  const chartCountByTrackId = new Map<string, number>();
  for (const row of chartRows) {
    chartCountByTrackId.set(row.retroverse_track_id, (chartCountByTrackId.get(row.retroverse_track_id) ?? 0) + 1);
  }

  const mediaThumbCountByTrackId = new Map<string, number>();
  for (const row of mediaAssets) {
    if (!row.thumbnail_path) continue;
    mediaThumbCountByTrackId.set(row.retroverse_track_id, (mediaThumbCountByTrackId.get(row.retroverse_track_id) ?? 0) + 1);
  }

  const artworkRowsByAlbumId = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    artworkRowsByAlbumId.set(row.retroverse_album_id, [...(artworkRowsByAlbumId.get(row.retroverse_album_id) ?? []), row]);
  }

  const albumMembershipCountByArtistId = new Map<string, number>();
  for (const role of albumRoles) {
    albumMembershipCountByArtistId.set(role.retroverse_artist_id, (albumMembershipCountByArtistId.get(role.retroverse_artist_id) ?? 0) + 1);
  }

  // A) Artwork enrichment queue
  const artworkQueue: Array<{
    album_id: string;
    title: string;
    artist: string;
    release_year: number | null;
    canonical_artwork_status: "missing" | "broken";
    fallback_thumb_available: boolean;
    connected_track_count: number;
    charted_track_count: number;
    artist_membership_count: number;
    enrichment_priority_score: number;
    suggested_target_path: string;
  }> = [];

  for (const album of albums) {
    const rows = artworkRowsByAlbumId.get(album.retroverse_album_id) ?? [];
    const preferred =
      rows.find((row) => row.is_primary && row.canonical_cover_path) ??
      rows.find((row) => row.artwork_role === "primary" && row.canonical_cover_path) ??
      rows.find((row) => row.canonical_cover_path);
    const canonicalPath = preferred?.canonical_cover_path?.trim() ?? null;
    let status: "missing" | "broken" | "ok" = "ok";
    if (!canonicalPath) {
      status = "missing";
    } else if (!(canonicalPath.startsWith("http://") || canonicalPath.startsWith("https://"))) {
      const localPath = path.join(WORKSPACE_ROOT, canonicalPath.replace(/^\/+/, ""));
      if (!(await fileExists(localPath))) status = "broken";
    }
    if (status === "ok") continue;

    const directTracks = directTrackIdsByAlbumId.get(album.retroverse_album_id) ?? new Set<string>();
    const sequencedTracks = sequencedTrackIdsByAlbumId.get(album.retroverse_album_id) ?? new Set<string>();
    const connectedTrackIds = new Set<string>([...directTracks, ...sequencedTracks]);
    const connectedTrackCount = connectedTrackIds.size;
    const chartedTrackCount = [...connectedTrackIds].filter((trackId) => (chartCountByTrackId.get(trackId) ?? 0) > 0).length;
    const fallbackThumbAvailable = [...connectedTrackIds].some((trackId) => (mediaThumbCountByTrackId.get(trackId) ?? 0) > 0);
    const artistMembershipCount = albumMembershipCountByArtistId.get(album.retroverse_artist_id) ?? 0;
    const artistName = artistById.get(album.retroverse_artist_id)?.canonical_artist_name ?? "Unknown artist";

    const priority =
      connectedTrackCount * 2 +
      chartedTrackCount * 3 +
      (fallbackThumbAvailable ? 1 : 0) +
      Math.min(artistMembershipCount, 6) +
      (status === "broken" ? 4 : 2);

    artworkQueue.push({
      album_id: album.retroverse_album_id,
      title: album.canonical_album_title,
      artist: artistName,
      release_year: album.release_year,
      canonical_artwork_status: status,
      fallback_thumb_available: fallbackThumbAvailable,
      connected_track_count: connectedTrackCount,
      charted_track_count: chartedTrackCount,
      artist_membership_count: artistMembershipCount,
      enrichment_priority_score: priority,
      suggested_target_path: `public/retroverse/covers/${album.retroverse_album_id}/cover.jpg`,
    });
  }
  artworkQueue.sort((a, b) => b.enrichment_priority_score - a.enrichment_priority_score || a.title.localeCompare(b.title));

  // B) Era-reference cleanup queue
  const artistNameList = artists.map((row) => row.canonical_artist_name);
  const albumTitleList = albums.map((row) => row.canonical_album_title);
  const trackTitleList = tracks.map((row) => row.canonical_title);

  function suggestCanonical(input: string, candidates: string[]): { candidate: string; score: number } | null {
    const normalizedInput = sanitizeEraToken(input);
    if (!normalizedInput) return null;
    const inputKey = normalizeText(normalizedInput);
    const exact = candidates.find((candidate) => normalizeText(candidate) === inputKey);
    if (exact) return { candidate: exact, score: 1 };

    const inputTokens = tokenSet(normalizedInput);
    let best: { candidate: string; score: number } | null = null;
    for (const candidate of candidates) {
      const score = jaccard(inputTokens, tokenSet(candidate));
      if (!best || score > best.score) best = { candidate, score };
    }
    if (!best || best.score < 0.82) return null;
    return best;
  }

  const eraReferenceQueue: Array<{
    era_slug: string;
    reference_type: "artist" | "album" | "song";
    raw_value: string;
    normalized_value: string;
    suggested_canonical: string | null;
    confidence: number;
    reason: string;
  }> = [];
  const noisyRegex = /(usage guidelines|for collectible|for navigation|for search|for editorial|for future ai|maintenance notes)/i;

  for (const era of getAllEras()) {
    const artistTokens = era.sections.definingArtists
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    for (const token of artistTokens) {
      const cleaned = sanitizeEraToken(token);
      if (!cleaned) continue;
      const suggestion = suggestCanonical(cleaned, artistNameList);
      if (!suggestion) {
        eraReferenceQueue.push({
          era_slug: era.slug,
          reference_type: "artist",
          raw_value: token,
          normalized_value: cleaned,
          suggested_canonical: null,
          confidence: 0,
          reason: noisyRegex.test(token) ? "noisy_string" : "unresolved_artist_reference",
        });
      } else if (suggestion.score < 1) {
        eraReferenceQueue.push({
          era_slug: era.slug,
          reference_type: "artist",
          raw_value: token,
          normalized_value: cleaned,
          suggested_canonical: suggestion.candidate,
          confidence: Number(suggestion.score.toFixed(3)),
          reason: "normalize_artist_reference",
        });
      }
    }

    for (const album of era.definingAlbums ?? []) {
      const cleaned = sanitizeEraToken(album);
      if (!cleaned) continue;
      const suggestion = suggestCanonical(cleaned, albumTitleList);
      if (!suggestion) {
        eraReferenceQueue.push({
          era_slug: era.slug,
          reference_type: "album",
          raw_value: album,
          normalized_value: cleaned,
          suggested_canonical: null,
          confidence: 0,
          reason: noisyRegex.test(album) ? "noisy_string" : "unresolved_album_reference",
        });
      } else if (suggestion.score < 1) {
        eraReferenceQueue.push({
          era_slug: era.slug,
          reference_type: "album",
          raw_value: album,
          normalized_value: cleaned,
          suggested_canonical: suggestion.candidate,
          confidence: Number(suggestion.score.toFixed(3)),
          reason: "normalize_album_reference",
        });
      }
    }

    for (const song of era.definingSongs ?? []) {
      const cleaned = sanitizeEraToken(song);
      if (!cleaned) continue;
      const suggestion = suggestCanonical(cleaned, trackTitleList);
      if (!suggestion) {
        eraReferenceQueue.push({
          era_slug: era.slug,
          reference_type: "song",
          raw_value: song,
          normalized_value: cleaned,
          suggested_canonical: null,
          confidence: 0,
          reason: noisyRegex.test(song) ? "noisy_string" : "unresolved_song_reference",
        });
      } else if (suggestion.score < 1) {
        eraReferenceQueue.push({
          era_slug: era.slug,
          reference_type: "song",
          raw_value: song,
          normalized_value: cleaned,
          suggested_canonical: suggestion.candidate,
          confidence: Number(suggestion.score.toFixed(3)),
          reason: "normalize_song_reference",
        });
      }
    }
  }

  // C) Weak slug + canonical ambiguity queue
  const slugCleanupQueue: Array<{
    source_match_id: string;
    entity_type: "artist" | "album" | "track";
    entity_id: string;
    source_key: string;
    expected_slug: string;
    suggested_suffix: string;
  }> = [];

  for (const row of sourceMatches) {
    if (row.retroverse_entity_type === "era") continue;
    const currentSuffix = row.source_key.split("::").pop()?.trim().toLowerCase() ?? "";
    let expectedSlug: string | null = null;
    if (row.retroverse_entity_type === "artist") {
      const artist = artistById.get(row.retroverse_entity_id);
      if (!artist) continue;
      expectedSlug = normalizeSlug(artist.canonical_artist_name);
    } else if (row.retroverse_entity_type === "album") {
      const album = albumById.get(row.retroverse_entity_id);
      if (!album) continue;
      expectedSlug = normalizeSlug(album.canonical_album_title);
    } else {
      const track = trackById.get(row.retroverse_entity_id);
      if (!track) continue;
      expectedSlug = normalizeSlug(track.canonical_title);
    }
    if (!expectedSlug || currentSuffix === expectedSlug) continue;
    slugCleanupQueue.push({
      source_match_id: row.retroverse_source_match_id,
      entity_type: row.retroverse_entity_type,
      entity_id: row.retroverse_entity_id,
      source_key: row.source_key,
      expected_slug: expectedSlug,
      suggested_suffix: `::${expectedSlug}`,
    });
  }

  const duplicateLike = {
    artists: new Map<string, string[]>(),
    albums: new Map<string, string[]>(),
    tracks: new Map<string, string[]>(),
  };
  for (const artist of artists) {
    const key = normalizeText(artist.canonical_artist_name);
    duplicateLike.artists.set(key, [...(duplicateLike.artists.get(key) ?? []), artist.retroverse_artist_id]);
  }
  for (const album of albums) {
    const key = normalizeText(album.canonical_album_title);
    duplicateLike.albums.set(key, [...(duplicateLike.albums.get(key) ?? []), album.retroverse_album_id]);
  }
  for (const track of tracks) {
    const artistName = artistById.get(track.retroverse_artist_id)?.canonical_artist_name ?? track.retroverse_artist_id;
    const key = `${normalizeText(track.canonical_title)}::${normalizeText(artistName)}`;
    duplicateLike.tracks.set(key, [...(duplicateLike.tracks.get(key) ?? []), track.retroverse_track_id]);
  }

  const ambiguousAlbumRelationships = new Map<string, Set<string>>();
  for (const row of albumTracks) {
    const albumId = editionById.get(row.retroverse_album_edition_id);
    if (!albumId) continue;
    ambiguousAlbumRelationships.set(
      row.retroverse_track_id,
      new Set([...(ambiguousAlbumRelationships.get(row.retroverse_track_id) ?? new Set<string>()), albumId]),
    );
  }

  const canonicalAmbiguityQueue = {
    duplicate_like_entities: {
      artists: [...duplicateLike.artists.entries()].filter(([, ids]) => ids.length > 1).slice(0, 30),
      albums: [...duplicateLike.albums.entries()].filter(([, ids]) => ids.length > 1).slice(0, 30),
      tracks: [...duplicateLike.tracks.entries()].filter(([, ids]) => ids.length > 1).slice(0, 30),
    },
    ambiguous_track_album_relationships: [...ambiguousAlbumRelationships.entries()]
      .filter(([, albumIds]) => albumIds.size > 1)
      .map(([trackId, albumIds]) => ({
        track_id: trackId,
        title: trackById.get(trackId)?.canonical_title ?? "Unknown track",
        album_count: albumIds.size,
        album_ids: [...albumIds],
      }))
      .sort((a, b) => b.album_count - a.album_count)
      .slice(0, 30),
  };

  const summary = {
    generated_at: new Date().toISOString(),
    counts: {
      total_albums: albums.length,
      artwork_queue_items: artworkQueue.length,
      era_reference_queue_items: eraReferenceQueue.length,
      slug_cleanup_items: slugCleanupQueue.length,
      duplicate_like_artist_groups: canonicalAmbiguityQueue.duplicate_like_entities.artists.length,
      duplicate_like_album_groups: canonicalAmbiguityQueue.duplicate_like_entities.albums.length,
      duplicate_like_track_groups: canonicalAmbiguityQueue.duplicate_like_entities.tracks.length,
      ambiguous_track_album_groups: canonicalAmbiguityQueue.ambiguous_track_album_relationships.length,
    },
    artwork_enrichment: {
      quick_win_targets: artworkQueue.slice(0, 75),
      status_breakdown: {
        missing: artworkQueue.filter((row) => row.canonical_artwork_status === "missing").length,
        broken: artworkQueue.filter((row) => row.canonical_artwork_status === "broken").length,
        with_fallback_thumb: artworkQueue.filter((row) => row.fallback_thumb_available).length,
      },
      estimated_coverage_after_top_75: {
        current_missing_or_broken: artworkQueue.length,
        resolved_if_top_75_completed: Math.min(75, artworkQueue.length),
        remaining: Math.max(0, artworkQueue.length - 75),
        percent_reduction: pct(Math.min(75, artworkQueue.length), artworkQueue.length),
      },
    },
    era_reference_cleanup: {
      high_frequency_patterns: [...new Map(
        eraReferenceQueue.map((row) => [`${row.reference_type}::${row.reason}`, (0)]),
      ).entries()]
        .map(([key]) => ({ pattern: key, count: eraReferenceQueue.filter((row) => `${row.reference_type}::${row.reason}` === key).length }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 12),
      queue: eraReferenceQueue.slice(0, 200),
    },
    weak_slug_cleanup: {
      queue: slugCleanupQueue.slice(0, 400),
      pct_of_source_matches: pct(slugCleanupQueue.length, sourceMatches.length),
    },
    canonical_ambiguities: canonicalAmbiguityQueue,
  };

  const id = runId();
  await mkdir(ENRICHMENT_LOG_ROOT, { recursive: true });
  const jsonPath = path.join(ENRICHMENT_LOG_ROOT, `${id}.json`);
  const mdPath = path.join(ENRICHMENT_LOG_ROOT, `${id}.md`);

  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const md = [
    `# Retroverse Archive Enrichment Queues ${id}`,
    "",
    `Generated: ${summary.generated_at}`,
    "",
    "## Queue Sizes",
    `- artwork targets: ${summary.counts.artwork_queue_items}`,
    `- era-reference cleanup rows: ${summary.counts.era_reference_queue_items}`,
    `- weak-slug cleanup rows: ${summary.counts.slug_cleanup_items}`,
    "",
    "## Artwork Quick-Win Impact",
    `- missing/broken canonical artwork: ${summary.artwork_enrichment.status_breakdown.missing + summary.artwork_enrichment.status_breakdown.broken}`,
    `- with fallback thumb available: ${summary.artwork_enrichment.status_breakdown.with_fallback_thumb}`,
    `- if top-75 resolved, reduction: ${summary.artwork_enrichment.estimated_coverage_after_top_75.percent_reduction}%`,
    "",
    "## Highest Frequency Era-Reference Patterns",
    ...summary.era_reference_cleanup.high_frequency_patterns.map((row) => `- ${row.pattern}: ${row.count}`),
    "",
    "## Weak Slug Cleanup",
    `- rows: ${summary.weak_slug_cleanup.queue.length}`,
    `- percent of source matches: ${summary.weak_slug_cleanup.pct_of_source_matches}%`,
    "",
    "## Canonical Ambiguities",
    `- duplicate-like artist groups: ${summary.counts.duplicate_like_artist_groups}`,
    `- duplicate-like album groups: ${summary.counts.duplicate_like_album_groups}`,
    `- duplicate-like track groups: ${summary.counts.duplicate_like_track_groups}`,
    `- ambiguous track->album groups: ${summary.counts.ambiguous_track_album_groups}`,
    "",
    `JSON report: ${jsonPath}`,
  ].join("\n");
  await writeFile(mdPath, `${md}\n`, "utf8");

  console.log(`archive_enrichment_json=${jsonPath}`);
  console.log(`archive_enrichment_md=${mdPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(message);
  process.exitCode = 1;
});

