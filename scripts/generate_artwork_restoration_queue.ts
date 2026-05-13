import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  era_id: string | null;
  album_type: string;
  soundtrack_flag: boolean;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
};

type TrackRow = {
  retroverse_track_id: string;
  retroverse_album_id: string | null;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
};

type ChartRow = {
  retroverse_track_id: string;
};

type ArtworkRow = {
  retroverse_album_artwork_id?: string;
  retroverse_album_id: string;
  artwork_status: string;
  is_primary?: boolean;
  artwork_role?: string | null;
  canonical_cover_path: string | null;
};

type AlbumRoleRow = {
  retroverse_album_id: string;
  retroverse_artist_id: string;
};

type QueueRow = {
  retroverse_album_id: string;
  artist: string;
  album: string;
  release_year: number | null;
  era_slug: string;
  priority_score: number;
  artwork_status: string;
  likely_itunes_search_query: string;
  discogs_fallback_query: string;
};

const OUTPUT_DIR = "/Users/bobhopp/RETROVERSE_DATA/generated/artwork_restoration";
const OUTPUT_CSV = path.join(OUTPUT_DIR, "queue.csv");
const REPORT_JSON = path.join(OUTPUT_DIR, "queue_generation_report.json");

const PAGE_SIZE = 1000;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['".,!?/\\:;`~*+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 1));
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function isRecognizableTitle(title: string): boolean {
  const normalized = normalize(title);
  if (normalized.length < 3) return false;
  const genericOnly = /^(greatest hits|best of|collection|anthology|live|soundtrack)$/i.test(normalized);
  return !genericOnly;
}

function scoreSearchUsefulness(artist: string, album: string): number {
  const artistTokens = tokenSet(artist);
  const albumTokens = tokenSet(album);
  let score = 0;
  score += Math.min(artistTokens.size, 5) * 1.2;
  score += Math.min(albumTokens.size, 6) * 1.1;
  if (isRecognizableTitle(album)) score += 3;
  if (/soundtrack|original motion picture/i.test(album)) score += 1;
  if (/greatest hits|best of|anthology/i.test(album)) score += 1;
  return Number(score.toFixed(2));
}

function isSyntheticEditorialAlbum(album: AlbumRow): boolean {
  return (
    album.soundtrack_flag ||
    album.album_type === "compilation" ||
    album.album_type === "soundtrack"
  );
}

function artworkPickScore(row: ArtworkRow): number {
  let score = 0;
  if (row.canonical_cover_path?.trim()) score += 32;
  if (row.is_primary) score += 16;
  if (row.artwork_role === "primary") score += 8;
  return score;
}

function pickPrimaryArtwork(rows: ArtworkRow[]): ArtworkRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => {
    const d = artworkPickScore(b) - artworkPickScore(a);
    if (d !== 0) return d;
    return (a.retroverse_album_artwork_id ?? "").localeCompare(b.retroverse_album_artwork_id ?? "");
  })[0]!;
}

/** Queue if missing row, status missing/pending, or primary cover path empty (per requirements). */
function albumNeedsArtwork(rows: ArtworkRow[]): boolean {
  if (rows.length === 0) return true;
  const primary = pickPrimaryArtwork(rows);
  if (!primary) return true;
  const st = (primary.artwork_status ?? "").toLowerCase();
  if (st === "missing" || st === "pending") return true;
  const path = primary.canonical_cover_path?.trim();
  if (!path) return true;
  return false;
}

function queueReasonLabel(rows: ArtworkRow[]): "no_artwork_row" | "status_missing" | "status_pending" | "null_canonical_cover_path" {
  if (rows.length === 0) return "no_artwork_row";
  const primary = pickPrimaryArtwork(rows)!;
  const st = (primary.artwork_status ?? "").toLowerCase();
  if (st === "missing") return "status_missing";
  if (st === "pending") return "status_pending";
  return "null_canonical_cover_path";
}

function artworkStatusForCsv(rows: ArtworkRow[]): string {
  if (rows.length === 0) return "none";
  return pickPrimaryArtwork(rows)?.artwork_status ?? "none";
}

function toCsv(rows: QueueRow[]): string {
  const headers = [
    "retroverse_album_id",
    "artist",
    "album",
    "release_year",
    "era_slug",
    "priority_score",
    "artwork_status",
    "likely_itunes_search_query",
    "discogs_fallback_query",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.retroverse_album_id,
        row.artist,
        row.album,
        row.release_year === null ? "" : String(row.release_year),
        row.era_slug,
        String(row.priority_score),
        row.artwork_status,
        row.likely_itunes_search_query,
        row.discogs_fallback_query,
      ]
        .map((value) => csvEscape(value))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

async function fetchAllRows<T>(
  supabase: RetroverseSupabase,
  table: string,
  columns: string,
  orderColumn: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before queue generation.");
  }
  const supabase: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [
    albums,
    artists,
    eras,
    tracks,
    editions,
    albumTracks,
    chartRows,
    artworkRows,
    albumRoles,
  ] = await Promise.all([
    fetchAllRows<AlbumRow>(
      supabase,
      "retroverse_albums",
      "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, era_id, album_type, soundtrack_flag",
      "retroverse_album_id",
    ),
    fetchAllRows<ArtistRow>(
      supabase,
      "retroverse_artists",
      "retroverse_artist_id, canonical_artist_name",
      "retroverse_artist_id",
    ),
    fetchAllRows<EraRow>(supabase, "retroverse_eras", "retroverse_era_id, slug", "retroverse_era_id"),
    fetchAllRows<TrackRow>(
      supabase,
      "retroverse_tracks",
      "retroverse_track_id, retroverse_album_id",
      "retroverse_track_id",
    ),
    fetchAllRows<EditionRow>(
      supabase,
      "retroverse_album_editions",
      "retroverse_album_edition_id, retroverse_album_id",
      "retroverse_album_edition_id",
    ),
    fetchAllRows<AlbumTrackRow>(
      supabase,
      "retroverse_album_tracks",
      "retroverse_album_edition_id, retroverse_track_id",
      "retroverse_album_track_id",
    ),
    fetchAllRows<ChartRow>(
      supabase,
      "retroverse_chart_appearances",
      "retroverse_track_id",
      "retroverse_chart_id",
    ),
    fetchAllRows<ArtworkRow>(
      supabase,
      "retroverse_album_artwork",
      "retroverse_album_artwork_id, retroverse_album_id, artwork_status, is_primary, artwork_role, canonical_cover_path",
      "retroverse_album_artwork_id",
    ),
    fetchAllRows<AlbumRoleRow>(
      supabase,
      "retroverse_album_artist_roles",
      "retroverse_album_id, retroverse_artist_id",
      "retroverse_album_artist_role_id",
    ),
  ]);

  const artistById = new Map(artists.map((row) => [row.retroverse_artist_id, row.canonical_artist_name]));
  const eraSlugById = new Map(eras.map((row) => [row.retroverse_era_id, row.slug]));
  const editionToAlbum = new Map(editions.map((row) => [row.retroverse_album_edition_id, row.retroverse_album_id]));

  const chartCountByTrack = new Map<string, number>();
  for (const row of chartRows) {
    chartCountByTrack.set(row.retroverse_track_id, (chartCountByTrack.get(row.retroverse_track_id) ?? 0) + 1);
  }

  const connectedTrackIdsByAlbum = new Map<string, Set<string>>();
  for (const track of tracks) {
    if (!track.retroverse_album_id) continue;
    const set = connectedTrackIdsByAlbum.get(track.retroverse_album_id) ?? new Set<string>();
    set.add(track.retroverse_track_id);
    connectedTrackIdsByAlbum.set(track.retroverse_album_id, set);
  }
  for (const row of albumTracks) {
    const albumId = editionToAlbum.get(row.retroverse_album_edition_id);
    if (!albumId) continue;
    const set = connectedTrackIdsByAlbum.get(albumId) ?? new Set<string>();
    set.add(row.retroverse_track_id);
    connectedTrackIdsByAlbum.set(albumId, set);
  }

  const artistRecurrence = new Map<string, number>();
  for (const row of albumRoles) {
    artistRecurrence.set(row.retroverse_artist_id, (artistRecurrence.get(row.retroverse_artist_id) ?? 0) + 1);
  }
  for (const album of albums) {
    if (!artistRecurrence.has(album.retroverse_artist_id)) {
      artistRecurrence.set(album.retroverse_artist_id, 1);
    }
  }

  const artworkRowsByAlbum = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    artworkRowsByAlbum.set(row.retroverse_album_id, [...(artworkRowsByAlbum.get(row.retroverse_album_id) ?? []), row]);
  }

  const totalCanonicalAlbums = albums.length;
  let corpusSynthetic = 0;
  let corpusReal = 0;
  let usableArtworkAlbums = 0;

  const queue: QueueRow[] = [];
  const composition: Record<string, number> = {
    no_artwork_row: 0,
    status_missing: 0,
    status_pending: 0,
    null_canonical_cover_path: 0,
  };
  let queuedSynthetic = 0;
  let queuedReal = 0;

  for (const album of albums) {
    const artist = artistById.get(album.retroverse_artist_id) ?? "Unknown artist";
    const rows = artworkRowsByAlbum.get(album.retroverse_album_id) ?? [];

    if (isSyntheticEditorialAlbum(album)) corpusSynthetic += 1;
    else corpusReal += 1;

    if (!albumNeedsArtwork(rows)) {
      usableArtworkAlbums += 1;
      continue;
    }

    const reason = queueReasonLabel(rows);
    composition[reason] = (composition[reason] ?? 0) + 1;
    if (isSyntheticEditorialAlbum(album)) queuedSynthetic += 1;
    else queuedReal += 1;

    const artworkStatus = artworkStatusForCsv(rows);

    const connectedTrackIds = connectedTrackIdsByAlbum.get(album.retroverse_album_id) ?? new Set<string>();
    let chartCount = 0;
    for (const trackId of connectedTrackIds) {
      chartCount += chartCountByTrack.get(trackId) ?? 0;
    }
    const chartSignal = Math.min(chartCount, 40);
    const trackSignal = Math.min(connectedTrackIds.size, 30);
    const recurrenceSignal = Math.min(artistRecurrence.get(album.retroverse_artist_id) ?? 1, 25);
    const eraSignal = album.era_id ? 4 : 0;
    const yearSignal =
      album.release_year === null
        ? 1
        : album.release_year >= 1965 && album.release_year <= 1990
          ? 6
          : 3;
    const searchSignal = scoreSearchUsefulness(artist, album.canonical_album_title);
    const statusSignal = artworkStatus === "none" ? 14 : artworkStatus === "missing" ? 11 : 6;

    const priorityScore = Number(
      (
        chartSignal * 2.1 +
        trackSignal * 1.5 +
        recurrenceSignal * 1.4 +
        eraSignal +
        yearSignal +
        searchSignal +
        statusSignal
      ).toFixed(2),
    );

    const likelyItunes = `${artist} ${album.canonical_album_title}`.replace(/\s+/g, " ").trim();
    const discogsQuery = `${artist} ${album.canonical_album_title} ${album.release_year ?? ""}`.replace(/\s+/g, " ").trim();

    queue.push({
      retroverse_album_id: album.retroverse_album_id,
      artist,
      album: album.canonical_album_title,
      release_year: album.release_year,
      era_slug: album.era_id ? eraSlugById.get(album.era_id) ?? "unassigned" : "unassigned",
      priority_score: priorityScore,
      artwork_status: artworkStatus,
      likely_itunes_search_query: likelyItunes,
      discogs_fallback_query: discogsQuery,
    });
  }

  queue.sort((a, b) => b.priority_score - a.priority_score || a.artist.localeCompare(b.artist) || a.album.localeCompare(b.album));

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_CSV, toCsv(queue), "utf8");

  const high = queue.filter((row) => row.priority_score >= 120).length;
  const medium = queue.filter((row) => row.priority_score >= 80 && row.priority_score < 120).length;
  const low = queue.filter((row) => row.priority_score < 80).length;

  const report = {
    generated_at: new Date().toISOString(),
    total_canonical_albums: totalCanonicalAlbums,
    total_albums_with_usable_artwork: usableArtworkAlbums,
    total_queued_for_acquisition: queue.length,
    corpus_synthetic_editorial_albums: corpusSynthetic,
    corpus_real_historical_albums: corpusReal,
    queued_synthetic_editorial: queuedSynthetic,
    queued_real_historical: queuedReal,
    queue_composition_by_reason: composition,
    priority_distribution: { high_geq_120: high, medium_80_119: medium, low_lt_80: low },
    output_csv: OUTPUT_CSV,
  };

  await writeFile(REPORT_JSON, JSON.stringify(report, null, 2), "utf8");

  console.log("--- artwork_restoration_queue (full corpus) ---");
  console.log(`total_canonical_albums=${totalCanonicalAlbums}`);
  console.log(`total_albums_with_usable_artwork=${usableArtworkAlbums}`);
  console.log(`total_queued_for_acquisition=${queue.length}`);
  console.log(`corpus_synthetic_editorial_albums=${corpusSynthetic}`);
  console.log(`corpus_real_historical_albums=${corpusReal}`);
  console.log(`queued_synthetic_editorial=${queuedSynthetic}`);
  console.log(`queued_real_historical=${queuedReal}`);
  console.log(
    `queue_composition=${JSON.stringify(composition)}`,
  );
  console.log(`priority_distribution_high=${high} medium=${medium} low=${low}`);
  console.log(`artwork_queue_csv=${OUTPUT_CSV}`);
  console.log(`queue_report_json=${REPORT_JSON}`);
  console.log(`total_queue_size=${queue.length}`);
  console.log("top_25_queue_rows:");
  for (const row of queue.slice(0, 25)) {
    console.log(
      `- ${row.retroverse_album_id} | ${row.artist} - ${row.album} | year=${row.release_year ?? "n/a"} | status=${row.artwork_status} | score=${row.priority_score}`,
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(message);
  process.exitCode = 1;
});
