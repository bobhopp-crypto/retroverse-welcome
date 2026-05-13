/**
 * Import deduped historical Billboard 200 chart albums from SQLite into Retroverse (additive only).
 * Does not truncate, does not modify enrichment/discover, does not overwrite existing album rows.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";
import {
  BILLBOARD200_SOURCE,
  albumIdentityKey,
  classifyHistoricalAlbum,
  isExcludedSyntheticTitle,
  normalizeDisplayName,
  normalizeSlug,
  normalizeText,
  parseYearFromChartDate,
} from "./lib/billboard200-historical";

const DEFAULT_SQLITE =
  "/Users/bobhopp/Sites/retroverse/data/raw/charts/billboard-200-albums-charts.db";
const LOG_ROOT = "/Users/bobhopp/RETROVERSE_DATA/logs/billboard200-import";

const PAGE_SIZE = 1000;
const UPSERT_BATCH = 120;

const SQLITE_PATH = process.env.BILLBOARD200_SQLITE_PATH ?? DEFAULT_SQLITE;
const RUN_LIMIT = Math.max(0, Number.parseInt(process.env.BILLBOARD200_IMPORT_LIMIT ?? "0", 10));

type DedupedRow = { artist: string; album: string; first_chart_date: string };

type ExistingArtist = { retroverse_artist_id: string; canonical_artist_name: string };
type ExistingAlbum = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};
type ExistingEdition = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
  edition_key: string;
  is_primary: boolean;
};
type ExistingRole = {
  retroverse_album_artist_role_id: string;
  retroverse_album_id: string;
  retroverse_artist_id: string;
  relationship_role: string;
};
type ExistingSourceMatch = {
  retroverse_source_match_id: string;
  source: string;
  source_key: string;
  retroverse_entity_type: string;
  retroverse_entity_id: string;
};
type EraRow = { retroverse_era_id: string; slug: string; start_year: number; end_year: number };

function canonicalArtistKey(name: string): string {
  return normalizeText(name);
}

function canonicalAlbumKey(title: string, artistId: string): string {
  return `${normalizeText(title)}::${artistId}`;
}

function hashToSixDigits(input: string): number {
  const digest = createHash("sha1").update(input).digest("hex");
  const first = Number.parseInt(digest.slice(0, 12), 16);
  return first % 1_000_000;
}

function createAllocator(
  prefix: string,
  usedIds: Set<string>,
  seedMap: Map<string, string>,
): { allocate: (canonicalKey: string) => string } {
  const allocatedByCanonicalKey = new Map<string, string>(seedMap);
  return {
    allocate(canonicalKey: string): string {
      const existing = allocatedByCanonicalKey.get(canonicalKey);
      if (existing) return existing;
      let candidate = `${prefix}${String(hashToSixDigits(`${prefix}:${canonicalKey}`)).padStart(6, "0")}`;
      let guard = 0;
      while (usedIds.has(candidate)) {
        guard += 1;
        candidate = `${prefix}${String(hashToSixDigits(`${prefix}:${canonicalKey}:${guard}`)).padStart(6, "0")}`;
      }
      usedIds.add(candidate);
      allocatedByCanonicalKey.set(canonicalKey, candidate);
      return candidate;
    },
  };
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

async function fetchBillboardSourceMatches(supabase: RetroverseSupabase): Promise<ExistingSourceMatch[]> {
  return fetchAllRows<ExistingSourceMatch>(
    supabase,
    "retroverse_source_matches",
    "retroverse_source_match_id, source, source_key, retroverse_entity_type, retroverse_entity_id",
    "retroverse_source_match_id",
  ).then((rows) => rows.filter((r) => r.source === BILLBOARD200_SOURCE));
}

function eraIdForYear(year: number | null, eras: EraRow[]): string | null {
  if (year === null) return null;
  for (const e of eras) {
    if (year >= e.start_year && year <= e.end_year) return e.retroverse_era_id;
  }
  return null;
}

function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function batchInsert(
  supabase: RetroverseSupabase,
  table: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const chunk = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from(table).insert(chunk);
    if (error) throw error;
  }
}

async function batchUpsert(
  supabase: RetroverseSupabase,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
): Promise<void> {
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const chunk = rows.slice(i, i + UPSERT_BATCH);
    const { error } = await supabase.from(table).upsert(chunk, { onConflict });
    if (error) throw error;
  }
}

function loadDedupedAlbums(dbPath: string): DedupedRow[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const sql = `
      SELECT artist, album, date AS first_chart_date
      FROM (
        SELECT
          artist,
          album,
          date,
          row_number() OVER (
            PARTITION BY lower(trim(artist)), lower(trim(album))
            ORDER BY date ASC, id ASC
          ) AS rn
        FROM albums
        WHERE trim(COALESCE(artist, '')) != ''
          AND trim(COALESCE(album, '')) != ''
      )
      WHERE rn = 1
      ORDER BY first_chart_date ASC, artist ASC, album ASC
    `;
    return db.prepare(sql).all() as DedupedRow[];
  } finally {
    db.close();
  }
}

function acousticSidecarStats(dbPath: string): { acoustic_rows: number; distinct_album_ids: number } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const acoustic_rows = (db.prepare("SELECT COUNT(*) AS c FROM acoustic_features").get() as { c: number }).c;
    const distinct_album_ids = (
      db
        .prepare(
          "SELECT COUNT(DISTINCT album_id) AS c FROM acoustic_features WHERE album_id IS NOT NULL AND trim(CAST(album_id AS TEXT)) != ''",
        )
        .get() as { c: number }
    ).c;
    return { acoustic_rows, distinct_album_ids };
  } catch {
    return { acoustic_rows: 0, distinct_album_ids: 0 };
  } finally {
    db.close();
  }
}

async function main() {
  const runId = `billboard200_import_${makeRunId()}`;
  await mkdir(LOG_ROOT, { recursive: true });
  const reportPath = path.join(LOG_ROOT, `${runId}.json`);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const deduped = loadDedupedAlbums(SQLITE_PATH);
  const limited = RUN_LIMIT > 0 ? deduped.slice(0, RUN_LIMIT) : deduped;
  const acoustic = acousticSidecarStats(SQLITE_PATH);

  let excluded_synthetic_title = 0;
  const work: DedupedRow[] = [];
  for (const row of limited) {
    if (isExcludedSyntheticTitle(row.album)) {
      excluded_synthetic_title += 1;
      continue;
    }
    work.push(row);
  }

  const [
    existingArtists,
    existingAlbums,
    existingEditions,
    existingRoles,
    billboardMatches,
    eras,
  ] = await Promise.all([
    fetchAllRows<ExistingArtist>(
      supabase,
      "retroverse_artists",
      "retroverse_artist_id, canonical_artist_name",
      "retroverse_artist_id",
    ),
    fetchAllRows<ExistingAlbum>(
      supabase,
      "retroverse_albums",
      "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year",
      "retroverse_album_id",
    ),
    fetchAllRows<ExistingEdition>(
      supabase,
      "retroverse_album_editions",
      "retroverse_album_edition_id, retroverse_album_id, edition_key, is_primary",
      "retroverse_album_edition_id",
    ),
    fetchAllRows<ExistingRole>(
      supabase,
      "retroverse_album_artist_roles",
      "retroverse_album_artist_role_id, retroverse_album_id, retroverse_artist_id, relationship_role",
      "retroverse_album_artist_role_id",
    ),
    fetchBillboardSourceMatches(supabase),
    fetchAllRows<EraRow>(
      supabase,
      "retroverse_eras",
      "retroverse_era_id, slug, start_year, end_year",
      "retroverse_era_id",
    ),
  ]);

  const usedArtistIds = new Set(existingArtists.map((r) => r.retroverse_artist_id));
  const usedAlbumIds = new Set(existingAlbums.map((r) => r.retroverse_album_id));
  const usedEditionIds = new Set(existingEditions.map((r) => r.retroverse_album_edition_id));
  const usedRoleIds = new Set(existingRoles.map((r) => r.retroverse_album_artist_role_id));
  const usedSmIds = new Set(
    (
      await fetchAllRows<{ retroverse_source_match_id: string }>(
        supabase,
        "retroverse_source_matches",
        "retroverse_source_match_id",
        "retroverse_source_match_id",
      )
    ).map((r) => r.retroverse_source_match_id),
  );

  const artistByNameKey = new Map(existingArtists.map((r) => [canonicalArtistKey(r.canonical_artist_name), r]));
  const albumByCanon = new Map(
    existingAlbums.map((r) => [canonicalAlbumKey(r.canonical_album_title, r.retroverse_artist_id), r]),
  );
  const editionPrimaryByAlbum = new Map<string, boolean>();
  const editionKeySet = new Set<string>();
  for (const e of existingEditions) {
    editionKeySet.add(`${e.retroverse_album_id}::${normalizeText(e.edition_key)}`);
    if (e.is_primary) editionPrimaryByAlbum.set(e.retroverse_album_id, true);
  }
  const roleKeySet = new Set(
    existingRoles.map((r) => `${r.retroverse_album_id}::${r.retroverse_artist_id}::${normalizeText(r.relationship_role)}`),
  );

  const smUnique = new Set(
    billboardMatches.map((m) => `${normalizeText(m.source_key)}::${normalizeText(m.retroverse_entity_type)}`),
  );
  const sourceMappedArtistId = new Map<string, string>();
  const sourceMappedAlbumId = new Map<string, string>();
  for (const m of billboardMatches) {
    const k = normalizeText(m.source_key);
    if (m.retroverse_entity_type === "artist") sourceMappedArtistId.set(k, m.retroverse_entity_id);
    if (m.retroverse_entity_type === "album") sourceMappedAlbumId.set(k, m.retroverse_entity_id);
  }

  const artistAllocator = createAllocator("RVAR", usedArtistIds, new Map());
  const albumAllocator = createAllocator("RVAL", usedAlbumIds, new Map());
  const editionAllocator = createAllocator("RVED", usedEditionIds, new Map());
  const roleAllocator = createAllocator("RVRL", usedRoleIds, new Map());
  const smAllocator = createAllocator("RVSM", usedSmIds, new Map());

  const newArtists = new Map<string, { retroverse_artist_id: string; canonical_artist_name: string; sort_name: string; notes: string | null }>();
  const newAlbums = new Map<
    string,
    {
      retroverse_album_id: string;
      canonical_album_title: string;
      retroverse_artist_id: string;
      release_year: number | null;
      soundtrack_flag: boolean;
      era_id: string | null;
      release_date: string | null;
      album_type: string;
      notes: string | null;
    }
  >();
  const newEditions: Array<{
    retroverse_album_edition_id: string;
    retroverse_album_id: string;
    edition_key: string;
    edition_name: string;
    release_date: string | null;
    release_year: number | null;
    era_id: string | null;
    is_primary: boolean;
    notes: string | null;
  }> = [];
  const newRoles: Array<{
    retroverse_album_artist_role_id: string;
    retroverse_album_id: string;
    retroverse_artist_id: string;
    relationship_role: string;
    billing_order: number;
    notes: string | null;
  }> = [];
  const newSourceMatches: Array<{
    retroverse_source_match_id: string;
    source: string;
    source_key: string;
    source_title: string | null;
    source_artist: string | null;
    retroverse_entity_type: "artist" | "album";
    retroverse_entity_id: string;
    confidence_score: number;
    manual_override: boolean;
    verified_by: string;
    notes: string | null;
  }> = [];

  const notesForAlbum = (firstChartDate: string, year: number | null) =>
    [
      "Billboard 200 historical import.",
      `First Billboard 200 chart week: ${firstChartDate}.`,
      `SQLite: ${path.basename(SQLITE_PATH)}.`,
      year !== null ? `Inferred release_year: ${year} (chart week year).` : null,
    ]
      .filter(Boolean)
      .join(" ");

  for (const row of work) {
    const artistDisplay = normalizeDisplayName(row.artist);
    const albumDisplay = normalizeDisplayName(row.album);
    const year = parseYearFromChartDate(row.first_chart_date);
    const classed = classifyHistoricalAlbum(artistDisplay, albumDisplay);
    const era_id = eraIdForYear(year, eras);

    const artistSourceKey = normalizeText(`billboard200_artist::${canonicalArtistKey(artistDisplay)}`);
    const albumSourceKey = normalizeText(`billboard200_album::${albumIdentityKey(artistDisplay, albumDisplay)}`);

    let artistId = sourceMappedArtistId.get(artistSourceKey) ?? null;
    if (!artistId) {
      const hit = artistByNameKey.get(canonicalArtistKey(artistDisplay));
      if (hit) artistId = hit.retroverse_artist_id;
    }
    if (!artistId) {
      artistId = artistAllocator.allocate(`artist::${canonicalArtistKey(artistDisplay)}`);
      if (!newArtists.has(artistId)) {
        newArtists.set(artistId, {
          retroverse_artist_id: artistId,
          canonical_artist_name: artistDisplay,
          sort_name: artistDisplay,
          notes: "Created by Billboard 200 historical import.",
        });
      }
    }

    const canonAlbum = canonicalAlbumKey(albumDisplay, artistId);
    let albumId = sourceMappedAlbumId.get(albumSourceKey) ?? null;
    let existingAlbumRow = albumByCanon.get(canonAlbum) ?? null;
    if (!albumId && existingAlbumRow) albumId = existingAlbumRow.retroverse_album_id;
    if (!albumId) {
      albumId = albumAllocator.allocate(`album::${canonAlbum}`);
    }

    const smArtistKeyU = `${artistSourceKey}::artist`;
    if (!smUnique.has(smArtistKeyU)) {
      const smId = smAllocator.allocate(`sm::${smArtistKeyU}`);
      newSourceMatches.push({
        retroverse_source_match_id: smId,
        source: BILLBOARD200_SOURCE,
        source_key: artistSourceKey,
        source_title: artistDisplay,
        source_artist: artistDisplay,
        retroverse_entity_type: "artist",
        retroverse_entity_id: artistId,
        confidence_score: 1,
        manual_override: false,
        verified_by: runId,
        notes: "Billboard 200 SQLite → Retroverse artist mapping.",
      });
      smUnique.add(smArtistKeyU);
      sourceMappedArtistId.set(artistSourceKey, artistId);
    }

    const smAlbumKeyU = `${albumSourceKey}::album`;
    if (!smUnique.has(smAlbumKeyU)) {
      const smId = smAllocator.allocate(`sm::${smAlbumKeyU}`);
      newSourceMatches.push({
        retroverse_source_match_id: smId,
        source: BILLBOARD200_SOURCE,
        source_key: albumSourceKey,
        source_title: albumDisplay,
        source_artist: artistDisplay,
        retroverse_entity_type: "album",
        retroverse_entity_id: albumId,
        confidence_score: 1,
        manual_override: false,
        verified_by: runId,
        notes: "Billboard 200 SQLite → Retroverse album mapping.",
      });
      smUnique.add(smAlbumKeyU);
      sourceMappedAlbumId.set(albumSourceKey, albumId);
    }

    if (!existingAlbumRow && !albumByCanon.has(canonAlbum)) {
      if (!newAlbums.has(albumId)) {
        newAlbums.set(albumId, {
          retroverse_album_id: albumId,
          canonical_album_title: albumDisplay,
          retroverse_artist_id: artistId,
          release_year: year,
          soundtrack_flag: classed.soundtrack_flag,
          era_id,
          release_date: year !== null ? `${year}-01-01` : null,
          album_type: classed.album_type,
          notes: notesForAlbum(row.first_chart_date, year),
        });
        albumByCanon.set(canonAlbum, {
          retroverse_album_id: albumId,
          canonical_album_title: albumDisplay,
          retroverse_artist_id: artistId,
          release_year: year,
        });
      }
    }

    const needsEdition = !editionPrimaryByAlbum.get(albumId);
    if (needsEdition) {
      const edition_key = `billboard200-primary-${year ?? "unknown"}-${normalizeSlug(albumDisplay).slice(0, 40)}`;
      const ek = `${albumId}::${normalizeText(edition_key)}`;
      if (!editionKeySet.has(ek)) {
        const editionId = editionAllocator.allocate(`edition::${ek}`);
        newEditions.push({
          retroverse_album_edition_id: editionId,
          retroverse_album_id: albumId,
          edition_key,
          edition_name: "Billboard 200 primary edition",
          release_date: year !== null ? `${year}-01-01` : null,
          release_year: year,
          era_id,
          is_primary: true,
          notes: "Primary edition created by Billboard 200 historical import.",
        });
        editionKeySet.add(ek);
        editionPrimaryByAlbum.set(albumId, true);
      }
    }

    const rk = `${albumId}::${artistId}::primary`;
    if (!roleKeySet.has(rk)) {
      const roleId = roleAllocator.allocate(`role::${rk}`);
      newRoles.push({
        retroverse_album_artist_role_id: roleId,
        retroverse_album_id: albumId,
        retroverse_artist_id: artistId,
        relationship_role: "primary",
        billing_order: 1,
        notes: "Billboard 200 import primary album artist.",
      });
      roleKeySet.add(rk);
    }
  }

  console.log(
    `billboard200_import_plan sqlite_rows_deduped=${deduped.length} import_limit=${RUN_LIMIT || "none"} work_rows=${work.length} excluded_synthetic_title=${excluded_synthetic_title}`,
  );
  console.log(
    `billboard200_import_plan new_artists=${newArtists.size} new_albums=${newAlbums.size} editions=${newEditions.length} roles=${newRoles.length} source_matches=${newSourceMatches.length}`,
  );
  console.log(
    `billboard200_acoustic_sidecar acoustic_rows=${acoustic.acoustic_rows} distinct_album_ids=${acoustic.distinct_album_ids} (not imported; reference only)`,
  );

  if (newArtists.size > 0) {
    await batchUpsert(supabase, "retroverse_artists", [...newArtists.values()], "retroverse_artist_id");
  }
  if (newAlbums.size > 0) {
    await batchUpsert(supabase, "retroverse_albums", [...newAlbums.values()], "retroverse_album_id");
  }
  if (newEditions.length > 0) {
    await batchUpsert(supabase, "retroverse_album_editions", newEditions, "retroverse_album_id,edition_key");
  }
  if (newRoles.length > 0) {
    await batchUpsert(
      supabase,
      "retroverse_album_artist_roles",
      newRoles,
      "retroverse_album_id,retroverse_artist_id,relationship_role",
    );
  }
  if (newSourceMatches.length > 0) {
    await batchInsert(supabase, "retroverse_source_matches", newSourceMatches);
  }

  const report = {
    run_id: runId,
    sqlite_path: SQLITE_PATH,
    sqlite_rows_deduped: deduped.length,
    import_row_limit: RUN_LIMIT || null,
    work_rows: work.length,
    excluded_synthetic_title,
    acoustic_features: acoustic,
    upserted: {
      artists: newArtists.size,
      albums: newAlbums.size,
      editions: newEditions.length,
      album_artist_roles: newRoles.length,
      source_matches: newSourceMatches.length,
    },
    notes:
      "Additive import only: existing retroverse_album rows are not updated when canonical album already exists.",
    billboard200_source: BILLBOARD200_SOURCE,
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`billboard200_import_done report=${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
