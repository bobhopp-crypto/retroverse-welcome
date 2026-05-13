import { writeFile } from "node:fs/promises";

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";

import {
  ACOUSTIC_DB_PATH,
  ACOUSTIC_SOURCE_TABLE,
  ENRICHMENT_SOURCE,
  buildColumnMap,
  ensureAcousticLogDir,
  fingerprintRow,
  getRowValue,
  logFileBase,
  parseDateMaybe,
  parseIntMaybe,
  parseNumber,
} from "./lib/acoustic-enrichment";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";

const BATCH = Math.max(50, Math.min(500, Number.parseInt(process.env.ACOUSTIC_IMPORT_BATCH ?? "400", 10)));

type ExistingRow = {
  enrichment_id: string;
  source_fingerprint: string;
  retroverse_track_id: string | null;
  match_confidence: number | null;
  match_method: string | null;
};

type InsertRow = {
  enrichment_id: string;
  retroverse_track_id: string | null;
  source_song: string | null;
  source_album: string | null;
  source_artist: string | null;
  acousticness: number | null;
  danceability: number | null;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  loudness: number | null;
  speechiness: number | null;
  instrumentalness: number | null;
  duration_ms: number | null;
  time_signature: number | null;
  source_album_identity: string | null;
  source_fingerprint: string;
  enrichment_source: string;
  source_date: string | null;
  match_confidence: number | null;
  match_method: string | null;
  updated_at: string;
};

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function fetchExistingMap(
  supabase: RetroverseSupabase,
): Promise<Map<string, ExistingRow>> {
  const byFp = new Map<string, ExistingRow>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("retroverse_track_enrichment")
      .select(
        "enrichment_id,source_fingerprint,retroverse_track_id,match_confidence,match_method",
      )
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as ExistingRow[];
    if (rows.length === 0) break;
    for (const r of rows) {
      byFp.set(r.source_fingerprint, r);
    }
    if (rows.length < pageSize) break;
  }
  return byFp;
}

function allocateId(next: number, used: Set<string>): { id: string; next: number } {
  let n = next;
  let id = `RVEN${String(n).padStart(6, "0")}`;
  while (used.has(id)) {
    n += 1;
    id = `RVEN${String(n).padStart(6, "0")}`;
  }
  used.add(id);
  return { id, next: n + 1 };
}

function rowFromSqlite(
  raw: Record<string, unknown>,
  map: ReturnType<typeof buildColumnMap>,
  existing: ExistingRow | undefined,
  nextId: number,
  usedIds: Set<string>,
): { row: InsertRow; nextId: number } | null {
  const song = getRowValue(raw, map.source_song);
  const album = getRowValue(raw, map.source_album);
  const artist = getRowValue(raw, map.source_artist);
  const albumId = getRowValue(raw, map.source_album_identity);
  const fp = fingerprintRow(song, album, artist, albumId);

  if (!song?.trim() && !artist?.trim()) {
    return null;
  }

  let enrichment_id: string;
  let next = nextId;
  if (existing) {
    enrichment_id = existing.enrichment_id;
  } else {
    const a = allocateId(next, usedIds);
    enrichment_id = a.id;
    next = a.next;
  }

  const row: InsertRow = {
    enrichment_id,
    retroverse_track_id: existing?.retroverse_track_id ?? null,
    source_song: song,
    source_album: album,
    source_artist: artist,
    acousticness: parseNumber(getRowValue(raw, map.acousticness)),
    danceability: parseNumber(getRowValue(raw, map.danceability)),
    energy: parseNumber(getRowValue(raw, map.energy)),
    valence: parseNumber(getRowValue(raw, map.valence)),
    tempo: parseNumber(getRowValue(raw, map.tempo)),
    loudness: parseNumber(getRowValue(raw, map.loudness)),
    speechiness: parseNumber(getRowValue(raw, map.speechiness)),
    instrumentalness: parseNumber(getRowValue(raw, map.instrumentalness)),
    duration_ms: parseIntMaybe(getRowValue(raw, map.duration_ms)),
    time_signature: parseIntMaybe(getRowValue(raw, map.time_signature)),
    source_album_identity: albumId,
    source_fingerprint: fp,
    enrichment_source: ENRICHMENT_SOURCE,
    source_date: parseDateMaybe(getRowValue(raw, map.source_date)),
    match_confidence: existing?.match_confidence ?? null,
    match_method: existing?.match_method ?? null,
    updated_at: new Date().toISOString(),
  };
  return { row, nextId: next };
}

/** Last row wins per source_fingerprint (same ON CONFLICT key as upsert). */
function dedupeBatchByFingerprint(rows: InsertRow[]): { deduped: InsertRow[]; duplicateRowsSkipped: number } {
  const lastByFp = new Map<string, InsertRow>();
  for (const row of rows) {
    lastByFp.set(row.source_fingerprint, row);
  }
  const deduped = [...lastByFp.values()];
  return { deduped, duplicateRowsSkipped: rows.length - deduped.length };
}

async function main() {
  await ensureAcousticLogDir();

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY for import.");
  }

  const supabase: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const db = new Database(ACOUSTIC_DB_PATH, { readonly: true });
  let sqliteRows = 0;
  let skippedEmpty = 0;
  let batchErrors = 0;
  let duplicateRowsSkipped = 0;
  let effectiveRowsInserted = 0;
  let effectiveRowsUpdated = 0;

  try {
    const cols = db.prepare(`PRAGMA table_info(${quoteIdent(ACOUSTIC_SOURCE_TABLE)})`).all() as { name: string }[];
    if (cols.length === 0) {
      throw new Error(`Table ${ACOUSTIC_SOURCE_TABLE} not found or has no columns. Run audit and set ACOUSTIC_SOURCE_TABLE.`);
    }
    const colMap = buildColumnMap(new Set(cols.map((c) => c.name)));
    if (!colMap.source_song && !colMap.source_artist) {
      throw new Error(
        "Could not resolve source_song/source_artist columns — check SQLite schema and extend aliases in scripts/lib/acoustic-enrichment.ts",
      );
    }

    const byFp = await fetchExistingMap(supabase);
    const usedIds = new Set<string>([...byFp.values()].map((r) => r.enrichment_id));
    let nextId =
      [...byFp.values()].reduce((m, r) => {
        const n = Number.parseInt(r.enrichment_id.replace(/^RVEN/i, ""), 10);
        return Number.isFinite(n) && n > m ? n : m;
      }, 0) + 1;

    const stmt = db.prepare(`SELECT * FROM ${quoteIdent(ACOUSTIC_SOURCE_TABLE)}`);
    let batch: InsertRow[] = [];
    /** Fingerprints already present in Supabase before this run, or successfully upserted earlier in this run. */
    const fpPersisted = new Set<string>(byFp.keys());

    const flush = async () => {
      if (batch.length === 0) return;
      const { deduped, duplicateRowsSkipped: skippedInBatch } = dedupeBatchByFingerprint(batch);
      duplicateRowsSkipped += skippedInBatch;
      batch = [];

      let batchInserted = 0;
      let batchUpdated = 0;
      for (const row of deduped) {
        if (fpPersisted.has(row.source_fingerprint)) batchUpdated += 1;
        else batchInserted += 1;
      }

      const { error } = await supabase.from("retroverse_track_enrichment").upsert(deduped, {
        onConflict: "source_fingerprint",
      });
      if (error) {
        console.error("acoustic_import_batch_error:", error.message);
        batchErrors += deduped.length;
      } else {
        effectiveRowsInserted += batchInserted;
        effectiveRowsUpdated += batchUpdated;
        for (const row of deduped) {
          fpPersisted.add(row.source_fingerprint);
        }
      }
    };

    for (const raw of stmt.iterate() as Iterable<Record<string, unknown>>) {
      sqliteRows += 1;
      const existing = byFp.get(
        fingerprintRow(
          getRowValue(raw, colMap.source_song),
          getRowValue(raw, colMap.source_album),
          getRowValue(raw, colMap.source_artist),
          getRowValue(raw, colMap.source_album_identity),
        ),
      );
      const built = rowFromSqlite(raw, colMap, existing, nextId, usedIds);
      if (!built) {
        skippedEmpty += 1;
        continue;
      }
      nextId = built.nextId;
      byFp.set(built.row.source_fingerprint, {
        enrichment_id: built.row.enrichment_id,
        source_fingerprint: built.row.source_fingerprint,
        retroverse_track_id: built.row.retroverse_track_id,
        match_confidence: built.row.match_confidence,
        match_method: built.row.match_method,
      });
      batch.push(built.row);
      if (batch.length >= BATCH) await flush();
    }
    await flush();

    const summary = {
      generated_at: new Date().toISOString(),
      sqlite_path: ACOUSTIC_DB_PATH,
      source_table: ACOUSTIC_SOURCE_TABLE,
      sqlite_rows_seen: sqliteRows,
      duplicate_rows_skipped_within_batch: duplicateRowsSkipped,
      effective_rows_inserted: effectiveRowsInserted,
      effective_rows_updated: effectiveRowsUpdated,
      skipped_empty_key: skippedEmpty,
      batch_errors_rows: batchErrors,
      enrichment_source: ENRICHMENT_SOURCE,
    };
    const out = logFileBase("import_summary", "json");
    await writeFile(out, JSON.stringify(summary, null, 2), "utf8");
    console.log("acoustic_import_complete");
    console.log(`import_summary=${out}`);
    console.log(
      `sqlite_rows=${sqliteRows} duplicate_rows_skipped=${duplicateRowsSkipped} effective_rows_inserted=${effectiveRowsInserted} effective_rows_updated=${effectiveRowsUpdated} skipped_empty=${skippedEmpty} batch_errors_rows=${batchErrors}`,
    );
  } finally {
    db.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
