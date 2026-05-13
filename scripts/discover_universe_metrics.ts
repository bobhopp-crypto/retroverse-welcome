import { readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_album_id: string | null;
};

type SourceMatchRow = {
  retroverse_source_match_id: string;
  retroverse_entity_type: string;
  retroverse_entity_id: string;
  source_title: string | null;
  source_artist: string | null;
};

type ArtworkRow = {
  retroverse_album_artwork_id?: string;
  retroverse_album_id: string;
  retroverse_album_edition_id: string | null;
  artwork_role: string;
  is_primary?: boolean;
  canonical_cover_path: string | null;
  artwork_status?: string | null;
};

type EraRecord = {
  slug: string;
  years: string;
  title: string;
};

type TrustState = "verified" | "provisional" | "unresolved";

const PAGE_SIZE = 1_000;
const SEARCH_PROBES = ["Def Leppard", "Led Zeppelin", "Purple Rain", "Thriller", "Hotel California"] as const;

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function safeText(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function classifyTrustState(artworkStatus: string | null | undefined, canonicalCoverPath: string | null): TrustState {
  const status = (artworkStatus ?? "").toLowerCase();
  if (
    !canonicalCoverPath ||
    status === "missing" ||
    status === "rejected" ||
    status === "low_confidence" ||
    status === "unresolved"
  ) {
    return "unresolved";
  }
  if (
    status === "pending" ||
    status === "needs_review" ||
    status === "provisional" ||
    status === "review_needed" ||
    status === "candidate"
  ) {
    return "provisional";
  }
  return "verified";
}

function artworkPriority(row: ArtworkRow): number {
  let score = 0;
  if (row.canonical_cover_path) score += 32;
  if (row.is_primary) score += 16;
  if (row.artwork_role === "primary") score += 8;
  if (row.retroverse_album_edition_id === null) score += 2;
  return score;
}

function selectCanonicalArtwork(rows: ArtworkRow[]): ArtworkRow | null {
  if (rows.length === 0) return null;
  const sorted = [...rows].sort(
    (a, b) =>
      artworkPriority(b) - artworkPriority(a) ||
      safeText(a.retroverse_album_artwork_id).localeCompare(safeText(b.retroverse_album_artwork_id)),
  );
  return sorted[0] ?? null;
}

function decadeKey(year: number | null): string {
  if (!year) return "unknown";
  return `${Math.floor(year / 10) * 10}s`;
}

function parseEraRange(years: string): { start: number; end: number } | null {
  const [startRaw, endRaw] = years.split("-").map((item) => item.trim());
  const start = Number.parseInt(startRaw ?? "", 10);
  const end = Number.parseInt(endRaw ?? "", 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
}

function eraSlugForYear(eras: EraRecord[], year: number | null): string {
  if (!year) return "unknown";
  const match = eras.find((era) => {
    const range = parseEraRange(era.years);
    return range ? year >= range.start && year <= range.end : false;
  });
  return match?.slug ?? "out_of_defined_eras";
}

async function loadEras(): Promise<EraRecord[]> {
  const erasPath = path.join(process.cwd(), "data/eras.json");
  const raw = await readFile(erasPath, "utf8");
  const parsed = JSON.parse(raw) as { eras?: EraRecord[] };
  return (parsed.eras ?? []).filter((era) => Boolean(era.slug && era.years));
}

async function fetchAllRows<T>(
  client: RetroverseSupabase,
  table: string,
  selectColumns: string,
  orderColumn: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(selectColumns)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function mapCounts(rows: string[]): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const row of rows) map.set(row, (map.get(row) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function printSection(title: string) {
  console.log(`\n${title}`);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY first.");
  }

  const client: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eras = await loadEras();
  const [albums, artists, tracks, sourceMatches, artworkRowsRaw] = await Promise.all([
    fetchAllRows<AlbumRow>(
      client,
      "retroverse_albums",
      "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year",
      "retroverse_album_id",
    ),
    fetchAllRows<ArtistRow>(client, "retroverse_artists", "retroverse_artist_id, canonical_artist_name", "retroverse_artist_id"),
    fetchAllRows<TrackRow>(client, "retroverse_tracks", "retroverse_track_id, canonical_title, retroverse_album_id", "retroverse_track_id"),
    fetchAllRows<SourceMatchRow>(
      client,
      "retroverse_source_matches",
      "retroverse_source_match_id, retroverse_entity_type, retroverse_entity_id, source_title, source_artist",
      "retroverse_source_match_id",
    ),
    fetchAllRows<ArtworkRow>(
      client,
      "retroverse_album_artwork",
      "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, is_primary, canonical_cover_path, artwork_status",
      "retroverse_album_artwork_id",
    ).catch(async (error) => {
      if ((error as { code?: string }).code !== "42703") throw error;
      return fetchAllRows<ArtworkRow>(
        client,
        "retroverse_album_artwork",
        "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, canonical_cover_path, artwork_status",
        "retroverse_album_artwork_id",
      );
    }),
  ]);

  const artworkRows = artworkRowsRaw.map((row) => ({
    ...row,
    is_primary: row.is_primary ?? row.artwork_role === "primary",
  }));

  const artworkByAlbumId = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    const existing = artworkByAlbumId.get(row.retroverse_album_id) ?? [];
    existing.push(row);
    artworkByAlbumId.set(row.retroverse_album_id, existing);
  }

  let verifiedArtwork = 0;
  let provisionalArtwork = 0;
  let unresolvedArtwork = 0;
  let albumsWithArtworkRows = 0;

  for (const album of albums) {
    const rows = artworkByAlbumId.get(album.retroverse_album_id) ?? [];
    if (rows.length > 0) albumsWithArtworkRows += 1;
    const selected = selectCanonicalArtwork(rows);
    const trust = classifyTrustState(selected?.artwork_status, selected?.canonical_cover_path ?? null);
    if (trust === "verified") verifiedArtwork += 1;
    if (trust === "provisional") provisionalArtwork += 1;
    if (trust === "unresolved") unresolvedArtwork += 1;
  }

  const decadeCoverage = mapCounts(albums.map((album) => decadeKey(album.release_year)));
  const eraCoverage = mapCounts(albums.map((album) => eraSlugForYear(eras, album.release_year)));

  const artistById = new Map(artists.map((artist) => [artist.retroverse_artist_id, artist.canonical_artist_name]));
  const albumTokens = albums.map((album) => normalizeText(album.canonical_album_title));
  const artistTokens = artists.map((artist) => normalizeText(artist.canonical_artist_name));
  const trackTokens = tracks.map((track) => normalizeText(track.canonical_title));
  const sourceTokens = sourceMatches.flatMap((row) => [normalizeText(safeText(row.source_title)), normalizeText(safeText(row.source_artist))]);
  const albumArtistTokens = albums.map((album) => normalizeText(artistById.get(album.retroverse_artist_id) ?? ""));

  const probeResults = SEARCH_PROBES.map((probe) => {
    const needle = normalizeText(probe);
    const inArtists = artistTokens.some((value) => value.includes(needle));
    const inAlbums = albumTokens.some((value) => value.includes(needle));
    const inTracks = trackTokens.some((value) => value.includes(needle));
    const inSourceAliases = sourceTokens.some((value) => value.includes(needle));
    const inAlbumArtists = albumArtistTokens.some((value) => value.includes(needle));
    const available = inArtists || inAlbums || inTracks || inSourceAliases || inAlbumArtists;
    return { probe, available, inArtists, inAlbums, inTracks, inSourceAliases };
  });

  printSection("Discover Universe Metrics");
  console.log(`total_albums: ${albums.length}`);
  console.log(`total_artists: ${artists.length}`);
  console.log(`total_tracks: ${tracks.length}`);
  console.log(`albums_with_artwork_rows: ${albumsWithArtworkRows}`);
  console.log(`verified_artwork_count: ${verifiedArtwork}`);
  console.log(`provisional_artwork_count: ${provisionalArtwork}`);
  console.log(`unresolved_count: ${unresolvedArtwork}`);

  printSection("Decade Coverage");
  for (const [key, count] of decadeCoverage) {
    console.log(`${key}: ${count}`);
  }

  printSection("Era Coverage");
  for (const [key, count] of eraCoverage) {
    console.log(`${key}: ${count}`);
  }

  printSection("Search Probe Availability");
  for (const probe of probeResults) {
    const channels = [
      probe.inArtists ? "artist" : null,
      probe.inAlbums ? "album" : null,
      probe.inTracks ? "track" : null,
      probe.inSourceAliases ? "alias" : null,
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`${probe.probe}: ${probe.available ? `yes (${channels || "index"})` : "no"}`);
  }
}

main().catch((error) => {
  console.error("metrics_failed:", error);
  process.exitCode = 1;
});
