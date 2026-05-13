import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";

type CsvTrackRow = {
  albumSourceKey: string;
  albumTitle: string;
  albumArtist: string;
  trackTitle: string;
  trackArtist: string;
  releaseYear: number | null;
  discNumber: number;
  trackNumber: number;
  sideCode: string | null;
  sidePosition: number | null;
  notes: string | null;
};

type AlbumBundle = {
  albumSourceKey: string;
  albumTitle: string;
  albumArtist: string;
  releaseYear: number | null;
  rows: CsvTrackRow[];
  emotionalPriorityScore: number;
};

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

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
  is_primary: boolean;
  release_year: number | null;
};

type AlbumTrackRow = {
  retroverse_album_track_id: string;
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
  release_year: number | null;
  era_id: string | null;
};

type SourceMatchRow = {
  source_key: string;
  retroverse_entity_id: string;
};

const SOURCE_PATHS = (
  process.env.TRACKLIST_BACKFILL_SOURCES ??
  [
    "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/data/imports/canonical_1977_1979/tracks.csv",
    "/Users/bobhopp/RETROVERSE_DATA/imports/canonical/tracks.csv",
  ].join(",")
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const TARGET_ALBUMS = Number.parseInt(process.env.TRACKLIST_BACKFILL_TARGET_ALBUMS ?? "500", 10);
const COMPLETE_TRACK_THRESHOLD = Number.parseInt(process.env.TRACKLIST_COMPLETE_THRESHOLD ?? "8", 10);
const LOG_ROOT = process.env.TRACKLIST_BACKFILL_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/tracklist-backfill";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSlug(value: string): string {
  return normalize(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function parseIntOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadCsvTracks(csvPath: string): Promise<CsvTrackRow[]> {
  const raw = await readFile(csvPath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => normalize(h));
  const out: CsvTrackRow[] = [];

  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = cols[idx] ?? "";
    });
    out.push({
      albumSourceKey: row["album_source_key"] ?? "",
      albumTitle: row["album_title"] ?? "",
      albumArtist: row["album_artist"] ?? "",
      trackTitle: row["canonical_title"] ?? row["title"] ?? "",
      trackArtist: row["canonical_artist_name"] ?? row["artist_name"] ?? row["album_artist"] ?? "",
      releaseYear: parseIntOrNull(row["release_year"]),
      discNumber: parseIntOrNull(row["disc_number"]) ?? 1,
      trackNumber: parseIntOrNull(row["track_number"]) ?? 0,
      sideCode: row["side_code"] || null,
      sidePosition: parseIntOrNull(row["side_position"]),
      notes: row["notes"] || null,
    });
  }
  return out.filter((row) => row.albumSourceKey && row.trackTitle && row.trackNumber > 0);
}

function emotionalPriority(bundle: AlbumBundle): number {
  const anchors = [
    "rumours",
    "saturday night fever",
    "hotel california",
    "long run",
    "spirits having flown",
    "greatest hits",
    "fleetwood mac",
    "eagles",
    "bee gees",
  ];
  const title = normalize(bundle.albumTitle);
  const artist = normalize(bundle.albumArtist);
  let score = bundle.rows.length * 6;
  if (bundle.releaseYear !== null && bundle.releaseYear >= 1975 && bundle.releaseYear <= 1982) score += 12;
  if (anchors.some((token) => title.includes(token) || artist.includes(token))) score += 24;
  return score;
}

async function buildAlbumBundles(): Promise<AlbumBundle[]> {
  const allRows = (await Promise.all(SOURCE_PATHS.map((p) => loadCsvTracks(p).catch(() => [])))).flat();
  const grouped = new Map<string, CsvTrackRow[]>();
  for (const row of allRows) {
    const key = normalize(row.albumSourceKey);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  const bundles: AlbumBundle[] = [];
  for (const [albumSourceKey, rows] of grouped.entries()) {
    const sorted = [...rows].sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
    const first = sorted[0];
    if (sorted.length <= 1) continue;
    const bundle: AlbumBundle = {
      albumSourceKey,
      albumTitle: first.albumTitle,
      albumArtist: first.albumArtist,
      releaseYear: first.releaseYear,
      rows: sorted,
      emotionalPriorityScore: 0,
    };
    bundle.emotionalPriorityScore = emotionalPriority(bundle);
    bundles.push(bundle);
  }
  bundles.sort((a, b) => b.emotionalPriorityScore - a.emotionalPriorityScore || a.albumTitle.localeCompare(b.albumTitle));
  return bundles.slice(0, TARGET_ALBUMS);
}

function hashToSixDigits(input: string): number {
  const digest = createHash("sha1").update(input).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16) % 1_000_000;
}

function allocateId(prefix: string, canonical: string, usedIds: Set<string>): string {
  let probe = hashToSixDigits(`${prefix}:${canonical}`);
  for (let attempt = 0; attempt < 1_000_000; attempt += 1) {
    const candidate = `${prefix}${String(probe).padStart(6, "0")}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
    probe = (probe + 1) % 1_000_000;
  }
  throw new Error(`unable_to_allocate_id:${prefix}:${canonical}`);
}

function trackKey(title: string, artistId: string): string {
  return `${normalize(title)}::${artistId}`;
}

function classifyCoverage(count: number): "complete" | "partial" | "missing" {
  if (count >= COMPLETE_TRACK_THRESHOLD) return "complete";
  if (count > 0) return "partial";
  return "missing";
}

async function computeCoverageSnapshot(supabase: RetroverseSupabase) {
  const [albumsResult, editionsResult, albumTracksResult] = await Promise.all([
    supabase.from("retroverse_albums").select("retroverse_album_id"),
    supabase.from("retroverse_album_editions").select("retroverse_album_edition_id, retroverse_album_id, is_primary"),
    supabase.from("retroverse_album_tracks").select("retroverse_album_edition_id, track_number"),
  ]);
  for (const result of [albumsResult, editionsResult, albumTracksResult]) if (result.error) throw result.error;

  const albums = albumsResult.data ?? [];
  const editions = (editionsResult.data ?? []) as EditionRow[];
  const albumTracks = (albumTracksResult.data ?? []) as Array<{ retroverse_album_edition_id: string; track_number: number }>;
  const editionsByAlbum = new Map<string, EditionRow[]>();
  for (const edition of editions) {
    const current = editionsByAlbum.get(edition.retroverse_album_id) ?? [];
    current.push(edition);
    editionsByAlbum.set(edition.retroverse_album_id, current);
  }
  const countByEdition = new Map<string, number>();
  for (const row of albumTracks) {
    countByEdition.set(row.retroverse_album_edition_id, (countByEdition.get(row.retroverse_album_edition_id) ?? 0) + 1);
  }

  let complete = 0;
  let partial = 0;
  let missing = 0;
  for (const album of albums) {
    const editionsForAlbum = editionsByAlbum.get((album as { retroverse_album_id: string }).retroverse_album_id) ?? [];
    let bestCount = 0;
    for (const edition of editionsForAlbum) {
      const count = countByEdition.get(edition.retroverse_album_edition_id) ?? 0;
      if (count > bestCount) bestCount = count;
    }
    const coverage = classifyCoverage(bestCount);
    if (coverage === "complete") complete += 1;
    if (coverage === "partial") partial += 1;
    if (coverage === "missing") missing += 1;
  }
  const total = albums.length;
  const completePct = total > 0 ? Number(((complete / total) * 100).toFixed(2)) : 0;
  return { total, complete, partial, missing, completePct };
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before backfill.");
  }
  const supabase: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const before = await computeCoverageSnapshot(supabase);
  const bundles = await buildAlbumBundles();

  const [albumsResult, artistsResult, editionsResult, tracksResult, sourceMatchesResult, albumTracksResult] = await Promise.all([
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, era_id"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase.from("retroverse_album_editions").select("retroverse_album_edition_id, retroverse_album_id, is_primary, release_year"),
    supabase.from("retroverse_tracks").select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year, era_id"),
    supabase
      .from("retroverse_source_matches")
      .select("source_key, retroverse_entity_id")
      .eq("retroverse_entity_type", "album"),
    supabase.from("retroverse_album_tracks").select("retroverse_album_track_id, retroverse_album_edition_id, retroverse_track_id, disc_number, track_number"),
  ]);
  for (const result of [albumsResult, artistsResult, editionsResult, tracksResult, sourceMatchesResult, albumTracksResult]) {
    if (result.error) throw result.error;
  }

  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const artists = (artistsResult.data ?? []) as ArtistRow[];
  const editions = (editionsResult.data ?? []) as EditionRow[];
  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const sourceMatches = (sourceMatchesResult.data ?? []) as SourceMatchRow[];
  const albumTracks = (albumTracksResult.data ?? []) as AlbumTrackRow[];

  const artistByName = new Map(artists.map((row) => [normalize(row.canonical_artist_name), row]));
  const albumById = new Map(albums.map((row) => [row.retroverse_album_id, row]));
  const albumByArtistTitleYear = new Map<string, AlbumRow>();
  for (const album of albums) {
    const artistName = artists.find((row) => row.retroverse_artist_id === album.retroverse_artist_id)?.canonical_artist_name ?? "";
    albumByArtistTitleYear.set(`${normalize(artistName)}::${normalize(album.canonical_album_title)}::${album.release_year ?? "unknown"}`, album);
    albumByArtistTitleYear.set(`${normalize(artistName)}::${normalize(album.canonical_album_title)}::unknown`, album);
  }
  const albumIdBySourceKey = new Map(sourceMatches.map((row) => [normalize(row.source_key), row.retroverse_entity_id]));
  const editionsByAlbum = new Map<string, EditionRow[]>();
  for (const edition of editions) {
    const current = editionsByAlbum.get(edition.retroverse_album_id) ?? [];
    current.push(edition);
    editionsByAlbum.set(edition.retroverse_album_id, current);
  }
  const trackByCanonical = new Map(tracks.map((row) => [trackKey(row.canonical_title, row.retroverse_artist_id), row]));
  const existingSlot = new Map(albumTracks.map((row) => [`${row.retroverse_album_edition_id}::${row.disc_number}::${row.track_number}`, row]));
  const existingCountByEdition = new Map<string, number>();
  for (const row of albumTracks) {
    existingCountByEdition.set(row.retroverse_album_edition_id, (existingCountByEdition.get(row.retroverse_album_edition_id) ?? 0) + 1);
  }
  const usedTrackIds = new Set(tracks.map((row) => row.retroverse_track_id));
  const usedEditionIds = new Set(editions.map((row) => row.retroverse_album_edition_id));
  const usedAlbumTrackIds = new Set(albumTracks.map((row) => row.retroverse_album_track_id));

  const report = {
    runAt: new Date().toISOString(),
    targetAlbums: TARGET_ALBUMS,
    sourcePaths: SOURCE_PATHS,
    bundlesConsidered: bundles.length,
    appliedAlbums: 0,
    skippedAlbumsNoMatch: 0,
    skippedAlbumsAlreadyDense: 0,
    tracksCreated: 0,
    membershipsUpserted: 0,
    albumIdsUpdated: [] as string[],
    warnings: [] as string[],
    before,
    after: { total: 0, complete: 0, partial: 0, missing: 0, completePct: 0 },
  };

  for (const bundle of bundles) {
    let albumId = albumIdBySourceKey.get(normalize(bundle.albumSourceKey)) ?? null;
    if (!albumId) {
      const key = `${normalize(bundle.albumArtist)}::${normalize(bundle.albumTitle)}::${bundle.releaseYear ?? "unknown"}`;
      albumId = albumByArtistTitleYear.get(key)?.retroverse_album_id ?? null;
    }
    if (!albumId) {
      const looseMatches = albums.filter(
        (albumRow) =>
          normalize(albumRow.canonical_album_title) === normalize(bundle.albumTitle) &&
          (bundle.releaseYear === null || albumRow.release_year === null || bundle.releaseYear === albumRow.release_year),
      );
      if (looseMatches.length === 1) albumId = looseMatches[0].retroverse_album_id;
    }
    if (!albumId) {
      report.skippedAlbumsNoMatch += 1;
      report.warnings.push(`no_album_match:${bundle.albumArtist} - ${bundle.albumTitle} (${bundle.albumSourceKey})`);
      continue;
    }
    const album = albumById.get(albumId);
    if (!album) continue;

    const albumEditions = editionsByAlbum.get(albumId) ?? [];
    const bestExistingCount = albumEditions.reduce(
      (best, edition) => Math.max(best, existingCountByEdition.get(edition.retroverse_album_edition_id) ?? 0),
      0,
    );
    if (bestExistingCount >= COMPLETE_TRACK_THRESHOLD) {
      report.skippedAlbumsAlreadyDense += 1;
      continue;
    }
    let targetEdition =
      albumEditions
        .slice()
        .sort(
          (a, b) =>
            (existingCountByEdition.get(b.retroverse_album_edition_id) ?? 0) -
              (existingCountByEdition.get(a.retroverse_album_edition_id) ?? 0) ||
            Number(b.is_primary) - Number(a.is_primary) ||
            (a.release_year ?? 9999) - (b.release_year ?? 9999),
        )[0] ??
      albumEditions.find((row) => row.is_primary) ??
      albumEditions
        .slice()
        .sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))[0] ??
      null;
    if (!targetEdition) {
      const editionId = allocateId("RVED", `edition::${albumId}::primary`, usedEditionIds);
      const insertEdition = {
        retroverse_album_edition_id: editionId,
        retroverse_album_id: albumId,
        edition_key: `primary-${album.release_year ?? "unknown"}-${normalizeSlug(album.canonical_album_title).slice(0, 24)}`,
        edition_name: "Primary canonical edition",
        release_date: null,
        release_year: album.release_year,
        era_id: album.era_id,
        is_primary: true,
        notes: "Created by Wave1 tracklist backfill.",
      };
      const editionResult = await supabase.from("retroverse_album_editions").upsert(insertEdition, {
        onConflict: "retroverse_album_id,edition_key",
      });
      if (editionResult.error) throw editionResult.error;
      targetEdition = { retroverse_album_edition_id: editionId, retroverse_album_id: albumId, is_primary: true, release_year: album.release_year };
    }

    const currentCount = existingCountByEdition.get(targetEdition.retroverse_album_edition_id) ?? 0;
    if (currentCount >= bundle.rows.length) {
      report.skippedAlbumsAlreadyDense += 1;
      continue;
    }

    const albumArtist = artistByName.get(normalize(bundle.albumArtist)) ?? artists.find((row) => row.retroverse_artist_id === album.retroverse_artist_id) ?? null;
    for (const row of bundle.rows) {
      const trackArtist = artistByName.get(normalize(row.trackArtist)) ?? albumArtist;
      if (!trackArtist) {
        report.warnings.push(`no_track_artist:${row.trackArtist} for ${bundle.albumTitle}`);
        continue;
      }

      const canonicalKey = trackKey(row.trackTitle, trackArtist.retroverse_artist_id);
      let track = trackByCanonical.get(canonicalKey) ?? null;
      if (!track) {
        const trackId = allocateId("RVTR", `track::${canonicalKey}`, usedTrackIds);
        const insertTrack = {
          retroverse_track_id: trackId,
          canonical_title: row.trackTitle,
          retroverse_artist_id: trackArtist.retroverse_artist_id,
          retroverse_album_id: albumId,
          release_year: row.releaseYear ?? album.release_year,
          era_id: album.era_id,
          notes: row.notes,
        };
        const trackResult = await supabase.from("retroverse_tracks").upsert(insertTrack, { onConflict: "retroverse_track_id" });
        if (trackResult.error) throw trackResult.error;
        track = insertTrack;
        trackByCanonical.set(canonicalKey, track as TrackRow);
        report.tracksCreated += 1;
      }

      const slotKey = `${targetEdition.retroverse_album_edition_id}::${row.discNumber}::${row.trackNumber}`;
      const existing = existingSlot.get(slotKey);
      const albumTrackId = existing?.retroverse_album_track_id ?? allocateId("RVAT", `slot::${slotKey}`, usedAlbumTrackIds);
      const membership = {
        retroverse_album_track_id: albumTrackId,
        retroverse_album_edition_id: targetEdition.retroverse_album_edition_id,
        retroverse_track_id: track.retroverse_track_id,
        disc_number: row.discNumber,
        track_number: row.trackNumber,
        side_code: row.sideCode,
        side_position: row.sidePosition,
        soundtrack_exclusive: false,
        is_interlude: false,
        notes: row.notes,
      };
      const membershipResult = await supabase.from("retroverse_album_tracks").upsert(membership, {
        onConflict: "retroverse_album_edition_id,disc_number,track_number",
      });
      if (membershipResult.error) throw membershipResult.error;
      existingSlot.set(slotKey, {
        retroverse_album_track_id: albumTrackId,
        retroverse_album_edition_id: targetEdition.retroverse_album_edition_id,
        retroverse_track_id: track.retroverse_track_id,
        disc_number: row.discNumber,
        track_number: row.trackNumber,
      });
      if (!existing) {
        existingCountByEdition.set(
          targetEdition.retroverse_album_edition_id,
          (existingCountByEdition.get(targetEdition.retroverse_album_edition_id) ?? 0) + 1,
        );
      }
      report.membershipsUpserted += 1;
    }
    report.appliedAlbums += 1;
    report.albumIdsUpdated.push(albumId);
  }

  report.after = await computeCoverageSnapshot(supabase);

  const runId = `tracklist_backfill_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await mkdir(LOG_ROOT, { recursive: true });
  const reportPath = path.join(LOG_ROOT, `${runId}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  console.log("\nWave1 Tracklist Backfill Complete");
  console.log(`report_path: ${reportPath}`);
  console.log(`bundles_considered: ${report.bundlesConsidered}`);
  console.log(`applied_albums: ${report.appliedAlbums}`);
  console.log(`tracks_created: ${report.tracksCreated}`);
  console.log(`memberships_upserted: ${report.membershipsUpserted}`);
  console.log(`before_complete_partial_missing: ${report.before.complete}/${report.before.partial}/${report.before.missing}`);
  console.log(`after_complete_partial_missing: ${report.after.complete}/${report.after.partial}/${report.after.missing}`);
  console.log(`coverage_complete_pct_before_after: ${report.before.completePct}% -> ${report.after.completePct}%`);
}

main().catch((error) => {
  console.error("wave1_tracklist_backfill_failed:", error);
  process.exitCode = 1;
});
