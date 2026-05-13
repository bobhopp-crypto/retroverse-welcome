/**
 * Populates `retroverse_chart_appearances` with weekly **Billboard 200** marks, anchored by **`retroverse_album_id`**.
 * **`retroverse_track_id`** is set when a track exists (optional enrichment) but is not required for traversal.
 *
 * Requires service role (`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`).
 *
 * Env:
 * - `BILLBOARD200_SQLITE_PATH` — defaults beside `scripts/import_billboard200_albums.ts`
 * - `BILLBOARD200_CHART_ROWS_LIMIT` — max SQLite rows (0 = all)
 *
 * Run: npm run billboard200:chart-history
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import { createClient } from "@supabase/supabase-js";

import { BILLBOARD200_SOURCE, albumIdentityKey, normalizeText } from "./lib/billboard200-historical";

function loadEnvLocal() {
  try {
    const p = path.join(process.cwd(), ".env.local");
    const raw = readFileSync(p, "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

const WORKSPACE = process.cwd();
const DEFAULT_SQLITE =
  "/Users/bobhopp/Sites/retroverse/data/raw/charts/billboard-200-albums-charts.db";
const SQLITE_PATH = process.env.BILLBOARD200_SQLITE_PATH ?? DEFAULT_SQLITE;
const RUN_LIMIT = Math.max(0, Number.parseInt(process.env.BILLBOARD200_CHART_ROWS_LIMIT ?? "0", 10));
const UPSERT_BATCH = 100;

/** Matches `retroverseAlbumChartAppearances` whitelist (US Billboard 200 lane). */
const CHART_DISPLAY_NAME = "Billboard 200";

type ColumnInfo = { name: string; type: string; notnull: number; pk: number };

function lcMap(cols: ColumnInfo[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of cols) m[c.name.trim().toLowerCase()] = c.name;
  return m;
}

function pickCol(map: Record<string, string>, choices: string[]): string | null {
  for (const c of choices) {
    const hit = map[c.trim().toLowerCase()];
    if (hit) return hit;
  }
  return null;
}

function chartIdStable(seed: string, usedIds: Set<string>): string {
  let guard = 0;
  for (;;) {
    const digest = createHash("sha1")
      .update(`${seed}:${guard}`)
      .digest("hex")
      .slice(0, 12);
    const n = Number.parseInt(digest, 16) % 1_000_000;
    const candidate = `RVCH${String(n).padStart(6, "0")}`;
    if (!usedIds.has(candidate)) {
      usedIds.add(candidate);
      return candidate;
    }
    guard++;
    if (guard > 999_999) throw new Error("chart id allocation exhaustion");
  }
}

async function main() {
  loadEnvLocal();
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Set SUPABASE_SERVICE_ROLE_KEY (+ SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL).");
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const sqliteAbs = path.isAbsolute(SQLITE_PATH) ? SQLITE_PATH : path.join(WORKSPACE, SQLITE_PATH);

  process.stderr.write(`[bb200-chart] SQLite: ${sqliteAbs}\n`);

  let db: Database.Database;
  try {
    db = new Database(sqliteAbs, { readonly: true });
  } catch (e) {
    console.error(
      `[bb200-chart] Cannot open SQLite. Set BILLBOARD200_SQLITE_PATH or copy the billboard-200 SQLite into place.\n(${String(e)})`,
    );
    process.exit(2);
  }

  const info = db.prepare(`PRAGMA table_info(albums)`).all() as ColumnInfo[];
  if (info.length === 0) {
    console.error('[bb200-chart] SQLite has no table "albums".');
    process.exit(2);
  }
  const cmap = lcMap(info);
  const artistC = pickCol(cmap, ["artist", "artist_name", "performer"]);
  const albumC = pickCol(cmap, ["album", "album_title", "title"]);
  const dateC = pickCol(cmap, ["date", "chart_date", "week", "week_date"]);
  const rankC =
    pickCol(cmap, ["chart_position", "position", "rank", "peak", "peak_position"]) ?? pickCol(cmap, ["pos"]);
  if (!artistC || !albumC || !dateC || !rankC) {
    console.error(
      `[bb200-chart] albums table columns insufficient. Got: ${info.map((x) => x.name).join(", ")}`,
    );
    process.exit(2);
  }
  const weeksC = pickCol(cmap, ["weeks_on_chart", "weeks", "wk_on_chart", "chart_weeks"]);

  const selectParts = [`"${artistC}" AS artist_raw`, `"${albumC}" AS album_raw`, `"${dateC}" AS chart_date`];
  selectParts.push(`"${rankC}" AS chart_rank`);
  if (weeksC) selectParts.push(`"${weeksC}" AS chart_weeks`);
  else selectParts.push(`CAST(NULL AS INTEGER) AS chart_weeks`);

  const sql = `
    SELECT ${selectParts.join(", ")}
    FROM albums
    WHERE trim(COALESCE("${artistC}", '')) <> ''
      AND trim(COALESCE("${albumC}", '')) <> ''
      AND trim(COALESCE("${dateC}", '')) <> ''
    ORDER BY "${dateC}" ASC, chart_rank ASC, "${artistC}" ASC, "${albumC}" ASC
  `;

  const slimRows = db.prepare(sql).all() as Array<{
    artist_raw: string | null;
    album_raw: string | null;
    chart_date: string | null;
    chart_rank: number | string | null;
    chart_weeks: number | string | null;
  }>;
  db.close();

  const capped = RUN_LIMIT > 0 ? slimRows.slice(0, RUN_LIMIT) : slimRows;
  process.stderr.write(`[bb200-chart] SQLite weekly rows (${capped.length} of ${slimRows.length} loaded)\n`);

  process.stderr.write(`[bb200-chart] Loading ${BILLBOARD200_SOURCE} album source matches…\n`);
  const albumKeyToRetroverseId = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const page = await supabase
      .from("retroverse_source_matches")
      .select("source_key, retroverse_entity_type, retroverse_entity_id")
      .eq("source", BILLBOARD200_SOURCE)
      .eq("retroverse_entity_type", "album")
      .range(from, from + 999);
    if (page.error) throw page.error;
    const rows = page.data ?? [];
    if (rows.length === 0) break;
    for (const r of rows as Array<{ source_key: string; retroverse_entity_id: string }>) {
      albumKeyToRetroverseId.set(normalizeText(r.source_key), r.retroverse_entity_id.trim().toUpperCase());
    }
    if (rows.length < 1000) break;
  }
  process.stderr.write(`[bb200-chart] Source album keys: ${albumKeyToRetroverseId.size}\n`);

  const distinctAlbumIds = [...new Set(albumKeyToRetroverseId.values())];
  process.stderr.write(`[bb200-chart] Optional: resolve anchor tracks for enrichment (${distinctAlbumIds.length} albums)…\n`);
  const albumToAnchorTrack = new Map<string, string | null>();
  const FETCH_CHUNK = 250;
  for (let i = 0; i < distinctAlbumIds.length; i += FETCH_CHUNK) {
    const slice = distinctAlbumIds.slice(i, i + FETCH_CHUNK);
    const best = new Map<string, string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("retroverse_tracks")
        .select("retroverse_album_id, retroverse_track_id")
        .in("retroverse_album_id", slice)
        .range(from, from + 999);
      if (error) throw error;
      const rows = data ?? [];
      for (const row of rows) {
        const r = row as { retroverse_album_id: string | null; retroverse_track_id: string };
        const aid = String(r.retroverse_album_id ?? "").trim();
        const tid = String(r.retroverse_track_id ?? "").trim();
        if (!aid || !tid) continue;
        const prev = best.get(aid);
        if (!prev || tid < prev) best.set(aid, tid);
      }
      if (rows.length < 1000) break;
    }
    for (const aid of slice) {
      const tid = best.get(aid)?.trim().toUpperCase() ?? "";
      albumToAnchorTrack.set(aid, tid || null);
    }
  }

  const usedChartIds = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("retroverse_chart_appearances")
      .select("retroverse_chart_id")
      .range(from, from + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data as Array<{ retroverse_chart_id: string }>) usedChartIds.add(row.retroverse_chart_id);
    if (data.length < 1000) break;
  }

  type ChartUpsert = {
    retroverse_chart_id: string;
    retroverse_track_id: string | null;
    retroverse_album_id: string;
    chart_date: string;
    chart_name: string;
    chart_position: number;
    weeks_on_chart: number | null;
  };

  const batch: ChartUpsert[] = [];
  let skippedNoAlbum = 0;
  let queued = 0;
  let enrichedOptionalTrack = 0;

  const flush = async () => {
    if (batch.length === 0) return;
    const chunk = [...batch];
    batch.length = 0;
    const { error } = await supabase.from("retroverse_chart_appearances").upsert(chunk, {
      onConflict: "retroverse_chart_id",
    });
    if (error) throw error;
  };

  for (const row of capped) {
    const artist = String(row.artist_raw ?? "").replace(/\s+/g, " ").trim();
    const album = String(row.album_raw ?? "").replace(/\s+/g, " ").trim();
    const dateStrRaw = String(row.chart_date ?? "").trim();
    if (!artist || !album || !dateStrRaw) continue;
    const dateStr = dateStrRaw.slice(0, 10);

    const rk =
      typeof row.chart_rank === "number"
        ? row.chart_rank
        : Number.parseInt(String(row.chart_rank ?? "").trim(), 10);
    if (!Number.isFinite(rk) || rk <= 0) continue;

    const key = normalizeText(`billboard200_album::${albumIdentityKey(artist, album)}`);
    const albumId = albumKeyToRetroverseId.get(key);
    if (!albumId) {
      skippedNoAlbum++;
      continue;
    }

    const trackId = albumToAnchorTrack.get(albumId) ?? null;
    if (trackId) enrichedOptionalTrack++;

    let weeksNum: number | null = null;
    const rawW = row.chart_weeks;
    if (typeof rawW === "number" && Number.isFinite(rawW) && rawW >= 0) weeksNum = Math.floor(rawW);
    else if (typeof rawW === "string") {
      const x = Number.parseInt(rawW.trim(), 10);
      if (Number.isFinite(x) && x >= 0) weeksNum = x;
    }

    const cidSeed = `${CHART_DISPLAY_NAME}|${albumId}|${dateStr}|${Math.floor(rk)}`;
    const retroverse_chart_id = chartIdStable(cidSeed, usedChartIds);

    batch.push({
      retroverse_chart_id,
      retroverse_track_id: trackId,
      retroverse_album_id: albumId,
      chart_date: dateStr,
      chart_name: CHART_DISPLAY_NAME,
      chart_position: Math.floor(rk),
      weeks_on_chart: weeksNum,
    });

    queued++;
    if (batch.length >= UPSERT_BATCH) await flush();
  }

  await flush();

  process.stderr.write(
    `[bb200-chart] sqlite_weekly_rows_processed=${capped.length} upsert_queued=${queued} skipped_no_matching_album_key=${skippedNoAlbum} skipped_no_anchor_track=0 optional_track_enrichment=${enrichedOptionalTrack} album_only_rows=${queued - enrichedOptionalTrack}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
