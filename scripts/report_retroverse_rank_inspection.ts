/**
 * Retroverse Rank — inspection exports. Ranking mirrors `loadViewerRankedAlbumEntriesForYear`
 * in `lib/viewer-scope.ts` (`lib/portal-year-rank-sort.ts`).
 *
 * Run: npm run report:rank-inspection
 * Requires: NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (.env.local)
 * Heavy reads use Postgres RPC `retroverse_rank_inspection_chart_page` (+ bounds RPC), not PostgREST table routes.
 * Apply migration `supabase/migrations/20260511180000_rank_inspection_chart_stream_rpcs.sql` on the project DB first.
 *
 * Chart data is streamed in calendar-year windows with keyset pagination on `(chart_date, retroverse_chart_id)`.
 * Key outputs under `reports/retroverse-rank/`:
 *   retroverse_year_inventory.{csv,md}, retroverse_rank_source_migration*.{csv,md},
 *   retroverse_year_album_counts.csv, retroverse_all_ranked_appearances.csv, by_year/<YEAR>_ranked_appearances.csv, …
 *
 * Billboard **200 weekly** dimension rows (`chart_name = "Billboard 200"`) populate via **`npm run billboard200:chart-history`**.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

import { comparePortalYearAlbumRank } from "../lib/portal-year-rank-sort";
import { retroverseAlbumChartAppearances } from "../lib/billboard-album-chart-appearance";
import { albumIdFromChartAppearanceRow } from "../lib/chart-appearance-album-id";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

const WORKSPACE = process.cwd();
const OUT_DIR = path.join(WORKSPACE, "reports", "retroverse-rank");
const BY_YEAR_DIR = path.join(OUT_DIR, "by_year");

type ChartAggRow = {
  chart_date: string;
  chart_name: string;
  chart_position: number;
  weeks_on_chart: number | null;
  retroverse_album_id?: string | null;
  retroverse_tracks:
    | { retroverse_album_id: string | null }
    | { retroverse_album_id: string | null }[]
    | null;
};

type YearAlbumAgg = {
  albumId: string;
  chartRowCount: number;
  peakChartPosition: number;
  maxWeeksOnChart: number;
  firstChartDate: string;
  lastChartDate: string;
};

function loadEnvLocal() {
  try {
    const p = path.join(WORKSPACE, ".env.local");
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

function albumIdFromChartRow(row: ChartAggRow): string | null {
  return albumIdFromChartAppearanceRow(row);
}

function calendarYear(chartDateStr: string): number | null {
  const y = Number.parseInt(chartDateStr.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function csvEscapeCell(v: unknown): string {
  if (v == null || v === undefined) return "";
  const s = String(v);
  if (/[\r\n",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(csvEscapeCell).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscapeCell(r[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Rows per RPC call (server-side LIMIT; keep moderate for low latency under statement_timeout). */
const CHART_RPC_PAGE_SIZE = 3200;

type YearAggState = {
  agg: Map<number, Map<string, YearAlbumAgg>>;
  chartRowsPerYear: Map<number, number>;
};

type RpcChartRow = {
  retroverse_chart_id: string;
  chart_date: string;
  chart_name: string;
  chart_position: number;
  weeks_on_chart: number | null;
  appearance_album_id: string | null;
  retroverse_track_id: string | null;
  track_album_id: string | null;
};

function chartRowFromRpc(r: RpcChartRow): ChartAggRow {
  const appearanceRaw = r.appearance_album_id != null ? String(r.appearance_album_id).trim() : "";
  const trackRaw = r.track_album_id != null ? String(r.track_album_id).trim() : "";
  const appearance = appearanceRaw ? appearanceRaw : null;
  const trackAl = trackRaw ? trackRaw : null;
  return {
    chart_date: String(r.chart_date).slice(0, 10),
    chart_name: r.chart_name,
    chart_position: r.chart_position,
    weeks_on_chart: r.weeks_on_chart,
    retroverse_album_id: appearance,
    retroverse_tracks: !appearance && trackAl ? { retroverse_album_id: trackAl } : null,
  };
}

function applyChartRowToYearState(
  row: ChartAggRow,
  gate: ((name: string) => boolean) | undefined,
  state: YearAggState,
): void {
  if (gate && !gate(row.chart_name ?? "")) return;
  const yr = calendarYear(row.chart_date);
  if (yr === null) return;
  const albumId = albumIdFromChartRow(row);
  if (!albumId) return;
  const pos = row.chart_position;
  if (typeof pos !== "number" || !Number.isFinite(pos) || pos <= 0) return;
  const w = row.weeks_on_chart;
  const weeksNorm = typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : 0;

  state.chartRowsPerYear.set(yr, (state.chartRowsPerYear.get(yr) ?? 0) + 1);

  let yMap = state.agg.get(yr);
  if (!yMap) {
    yMap = new Map();
    state.agg.set(yr, yMap);
  }
  const prev = yMap.get(albumId);
  if (!prev) {
    yMap.set(albumId, {
      albumId,
      chartRowCount: 1,
      peakChartPosition: pos,
      maxWeeksOnChart: weeksNorm,
      firstChartDate: row.chart_date,
      lastChartDate: row.chart_date,
    });
  } else {
    prev.chartRowCount += 1;
    prev.peakChartPosition = Math.min(prev.peakChartPosition, pos);
    prev.maxWeeksOnChart = Math.max(prev.maxWeeksOnChart, weeksNorm);
    if (row.chart_date < prev.firstChartDate) prev.firstChartDate = row.chart_date;
    if (row.chart_date > prev.lastChartDate) prev.lastChartDate = row.chart_date;
  }
}

function feedRowIntoPipelines(
  row: ChartAggRow,
  legacyState: YearAggState,
  albumState: YearAggState,
  stats: { totalRawRows: number; billboardAlbumPipelineRows: number; chartNameTally: Map<string, number> },
): void {
  applyChartRowToYearState(row, undefined, legacyState);
  applyChartRowToYearState(row, retroverseAlbumChartAppearances, albumState);
  stats.totalRawRows += 1;
  const cn = String(row.chart_name ?? "").trim() || "(empty)";
  stats.chartNameTally.set(cn, (stats.chartNameTally.get(cn) ?? 0) + 1);
  if (retroverseAlbumChartAppearances(row.chart_name ?? "")) stats.billboardAlbumPipelineRows += 1;
}

/** Stream chart appearances via SQL RPC (indexed keyset, single join scan per page). */
async function streamAllChartAppearancesIntoAggregates(
  supabase: SupabaseClient,
  legacyState: YearAggState,
  albumState: YearAggState,
  stats: { totalRawRows: number; billboardAlbumPipelineRows: number; chartNameTally: Map<string, number> },
): Promise<void> {
  const { data: boundsRows, error: bErr } = await supabase.rpc("retroverse_rank_inspection_chart_date_bounds");
  if (bErr) {
    throw new Error(
      `${bErr.message} — apply migration 20260511180000_rank_inspection_chart_stream_rpcs.sql on the Supabase project (RPCs must exist).`,
      { cause: bErr },
    );
  }
  const bounds = (boundsRows ?? []) as { min_date?: string | null; max_date?: string | null }[];
  const minStr = bounds[0]?.min_date;
  const maxStr = bounds[0]?.max_date;
  if (!minStr || !maxStr) return;

  const y0 = calendarYear(String(minStr));
  const y1 = calendarYear(String(maxStr));
  if (y0 === null || y1 === null) return;

  for (let year = y0; year <= y1; year++) {
    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;

    let afterDate: string | null = null;
    let afterChartId: string | null = null;

    for (;;) {
      const { data, error } = await supabase.rpc("retroverse_rank_inspection_chart_page", {
        p_chart_date_start: start,
        p_chart_date_end_exclusive: end,
        p_after_date: afterDate,
        p_after_chart_id: afterChartId,
        p_limit: CHART_RPC_PAGE_SIZE,
      });
      if (error) {
        throw new Error(
          `${error.message} (if this is undefined_function, apply migration 20260511180000_rank_inspection_chart_stream_rpcs.sql)`,
          { cause: error },
        );
      }
      const rows = (data ?? []) as unknown as RpcChartRow[];
      if (rows.length === 0) break;

      for (const r of rows) {
        feedRowIntoPipelines(chartRowFromRpc(r), legacyState, albumState, stats);
      }

      const tail = rows[rows.length - 1]!;
      afterDate = String(tail.chart_date).slice(0, 10);
      afterChartId = tail.retroverse_chart_id;
      if (rows.length < CHART_RPC_PAGE_SIZE) break;
    }

    if (year % 5 === 0 || year === y1) {
      process.stderr.write(`[rank-inspection] … streamed through calendar ${year} · rows=${stats.totalRawRows}\n`);
    }
  }
}

const BASELINE_BB_ALBUM_SLOTS_CSV = path.join(OUT_DIR, "baseline_track_anchored_unique_albums_by_year.csv");

/** `unique_albums_billboard_album_chart_only` per year from before album-direct chart rows (track-anchored ingestion). */
function loadBillboardAlbumBaselineByYear(): Map<number, number> {
  const m = new Map<number, number>();
  try {
    const raw = readFileSync(BASELINE_BB_ALBUM_SLOTS_CSV, "utf8");
    const lines = raw.trim().split("\n");
    if (lines.length < 2) return m;
    const header = lines[0]!.split(",");
    const yi = header.indexOf("year");
    const ni = header.indexOf("unique_albums_billboard_album_chart_only");
    if (yi < 0 || ni < 0) return m;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      const cols = line.split(",");
      if (cols.length <= Math.max(yi, ni)) continue;
      const y = Number.parseInt(cols[yi]!.trim(), 10);
      const n = Number.parseInt(cols[ni]!.trim(), 10);
      if (Number.isFinite(y)) m.set(y, Number.isFinite(n) ? n : 0);
    }
  } catch {
    /* optional */
  }
  return m;
}

function readLegacySkippedBb200RowsNoTrack(): number | null {
  try {
    const p = path.join(OUT_DIR, "legacy_skipped_bb200_rows_no_anchor_track.txt");
    const t = readFileSync(p, "utf8").trim();
    const n = Number.parseInt(t, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

type AlbumMeta = {
  canonical_album_title: string;
  canonical_artist_name: string;
};

async function loadAlbumArtistMeta(supabase: SupabaseClient, albumIds: string[]): Promise<Map<string, AlbumMeta>> {
  const out = new Map<string, AlbumMeta>();
  const uniq = [...new Set(albumIds)].filter(Boolean);
  for (const idChunk of chunk(uniq, 120)) {
    const { data: albums, error: aErr } = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
      .in("retroverse_album_id", idChunk);
    if (aErr) throw aErr;
    const artistIds = [...new Set((albums ?? []).map((x: { retroverse_artist_id: string }) => x.retroverse_artist_id))];
    const artistName = new Map<string, string>();
    for (const arChunk of chunk(artistIds, 120)) {
      const { data: arts, error: arErr } = await supabase
        .from("retroverse_artists")
        .select("retroverse_artist_id, canonical_artist_name")
        .in("retroverse_artist_id", arChunk);
      if (arErr) throw arErr;
      for (const a of arts ?? []) {
        artistName.set(
          (a as { retroverse_artist_id: string }).retroverse_artist_id,
          String((a as { canonical_artist_name: string }).canonical_artist_name ?? "").trim() || "?",
        );
      }
    }
    for (const al of albums ?? []) {
      const aid = String((al as { retroverse_album_id: string }).retroverse_album_id).toUpperCase();
      const title = String((al as { canonical_album_title: string }).canonical_album_title ?? "").trim();
      const arid = (al as { retroverse_artist_id: string }).retroverse_artist_id;
      out.set(aid, {
        canonical_album_title: title || "?",
        canonical_artist_name: artistName.get(arid) ?? "?",
      });
    }
  }
  return out;
}

/** Distinct Retroverse albums appearing anywhere in aggregated year maps. */
function distinctAlbumIdsInAggPipe(agg: Map<number, Map<string, YearAlbumAgg>>): Set<string> {
  const s = new Set<string>();
  for (const m of agg.values()) {
    for (const id of m.keys()) s.add(id);
  }
  return s;
}

function albumSummaryLine(meta: Map<string, AlbumMeta>, agg: YearAlbumAgg, withPeak?: boolean): string {
  const m = meta.get(agg.albumId);
  const artist = m?.canonical_artist_name ?? "";
  const title = m?.canonical_album_title ?? "";
  const peak = withPeak !== false ? ` · peak=#${agg.peakChartPosition}` : "";
  return `${artist} — ${title} [${agg.albumId}]${peak}`;
}

function pickEarliestFirstChartYear(ranked: YearAlbumAgg[]): YearAlbumAgg | null {
  if (ranked.length === 0) return null;
  let best = ranked[0]!;
  for (let i = 1; i < ranked.length; i++) {
    const r = ranked[i]!;
    const c = r.firstChartDate.localeCompare(best.firstChartDate);
    if (c < 0 || (c === 0 && r.albumId.localeCompare(best.albumId) < 0)) best = r;
  }
  return best;
}

function pickLatestLastChartYear(ranked: YearAlbumAgg[]): YearAlbumAgg | null {
  if (ranked.length === 0) return null;
  let best = ranked[0]!;
  for (let i = 1; i < ranked.length; i++) {
    const r = ranked[i]!;
    const c = r.lastChartDate.localeCompare(best.lastChartDate);
    if (c > 0 || (c === 0 && r.albumId.localeCompare(best.albumId) < 0)) best = r;
  }
  return best;
}

/** Among this year's roster, highest count of distinct chart years (tie: better traversal rank first). */
function pickLongestPersistingThisYear(ranked: YearAlbumAgg[], albumYears: Map<string, Set<number>>): YearAlbumAgg | null {
  if (ranked.length === 0) return null;
  let bestIdx = 0;
  let bestYears = albumYears.get(ranked[0]!.albumId)?.size ?? 0;
  for (let i = 1; i < ranked.length; i++) {
    const r = ranked[i]!;
    const ny = albumYears.get(r.albumId)?.size ?? 0;
    if (ny > bestYears) {
      bestYears = ny;
      bestIdx = i;
    }
  }
  return ranked[bestIdx] ?? null;
}

/** Portal-aligned row order for a calendar year. */
function rankAppearances(yearMap: Map<string, YearAlbumAgg>, meta: Map<string, AlbumMeta>): YearAlbumAgg[] {
  return [...yearMap.values()].sort((a, b) =>
    comparePortalYearAlbumRank(
      {
        peakChartPosition: a.peakChartPosition,
        weeksOnChart: a.maxWeeksOnChart,
        weeklyChartRows: a.chartRowCount,
        firstChartDate: a.firstChartDate,
        artist: meta.get(a.albumId)?.canonical_artist_name ?? "",
        album: meta.get(a.albumId)?.canonical_album_title ?? "",
        albumId: a.albumId,
      },
      {
        peakChartPosition: b.peakChartPosition,
        weeksOnChart: b.maxWeeksOnChart,
        weeklyChartRows: b.chartRowCount,
        firstChartDate: b.firstChartDate,
        artist: meta.get(b.albumId)?.canonical_artist_name ?? "",
        album: meta.get(b.albumId)?.canonical_album_title ?? "",
        albumId: b.albumId,
      },
    ),
  );
}

/** Album-level source matches (entity_type = album); used for coverage heuristics only. */
async function fetchAlbumSourceMatchIds(
  supabase: SupabaseClient,
  albumIds: string[],
): Promise<Set<string>> {
  const matched = new Set<string>();
  const uniq = [...new Set(albumIds.map((id) => String(id).toUpperCase().trim()))].filter(Boolean);
  for (const idChunk of chunk(uniq, 100)) {
    const { data, error } = await supabase
      .from("retroverse_source_matches")
      .select("retroverse_entity_id")
      .eq("retroverse_entity_type", "album")
      .in("retroverse_entity_id", idChunk);
    if (error) throw error;
    for (const r of data ?? []) {
      const id = (r as { retroverse_entity_id: string }).retroverse_entity_id;
      if (id) matched.add(String(id).toUpperCase());
    }
  }
  return matched;
}

function neighborAvgRanked(
  y: number,
  yearsSet: Set<number>,
  byYearAgg: Map<number, Map<string, YearAlbumAgg>>,
): number | null {
  const vals: number[] = [];
  if (yearsSet.has(y - 1)) vals.push(byYearAgg.get(y - 1)!.size);
  if (yearsSet.has(y + 1)) vals.push(byYearAgg.get(y + 1)!.size);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function neighborAvgRaw(
  y: number,
  yearsSet: Set<number>,
  chartRowsPerYear: Map<number, number>,
): number | null {
  const vals: number[] = [];
  if (yearsSet.has(y - 1)) vals.push(chartRowsPerYear.get(y - 1) ?? 0);
  if (yearsSet.has(y + 1)) vals.push(chartRowsPerYear.get(y + 1) ?? 0);
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function rosterSourceMatchPct(
  y: number,
  byYearAgg: Map<number, Map<string, YearAlbumAgg>>,
  albumsWithSourceMatch: Set<string> | null,
): number | null {
  const m = byYearAgg.get(y);
  if (!m || m.size === 0 || !albumsWithSourceMatch) return null;
  let hit = 0;
  for (const id of m.keys()) {
    if (albumsWithSourceMatch.has(String(id).toUpperCase())) hit++;
  }
  return (hit / m.size) * 100;
}

type SuspiciousExportParams = {
  years: number[];
  byYearAgg: Map<number, Map<string, YearAlbumAgg>>;
  chartRowsPerYear: Map<number, number>;
  migrationByYearRows: Record<string, string | number>[];
  aggLegacyPipeline: YearAggState;
  slotMean: number;
  slotStdev: number;
  albumsWithSourceMatch: Set<string> | null;
  allAlbumIds: string[];
  chartNameTally: Map<string, number>;
  chartRowsLen: number;
  billboardAlbumChartRowCount: number;
};

function computeSuspiciousYearExport(p: SuspiciousExportParams): {
  suspiciousRows: Record<string, string | number>[];
  auditMd: string;
} {
  const {
    years,
    byYearAgg,
    chartRowsPerYear,
    migrationByYearRows,
    aggLegacyPipeline,
    slotMean,
    slotStdev,
    albumsWithSourceMatch,
    allAlbumIds,
    chartNameTally,
    chartRowsLen,
    billboardAlbumChartRowCount,
  } = p;

  const yearsSet = new Set(years);
  const migByYear = new Map<number, Record<string, string | number>>();
  for (const r of migrationByYearRows) migByYear.set(Number(r.year), r);

  const rankedOf = (y: number) => byYearAgg.get(y)?.size ?? 0;
  const rawOf = (y: number) => chartRowsPerYear.get(y) ?? 0;
  const densityOf = (y: number) => {
    const n = rankedOf(y);
    return n > 0 ? rawOf(y) / n : 0;
  };

  const densitiesForP = years.filter((y) => rankedOf(y) >= 10).map(densityOf).sort((a, b) => a - b);
  const densityP10 = densitiesForP.length ? densitiesForP[Math.floor((densitiesForP.length - 1) * 0.1)]! : 0;
  const densityMedian = densitiesForP.length
    ? densitiesForP[Math.floor((densitiesForP.length - 1) * 0.5)]!
    : 0;

  const globalSourcePct =
    albumsWithSourceMatch && allAlbumIds.length > 0
      ? (albumsWithSourceMatch.size / allAlbumIds.length) * 100
      : null;

  function collectIssueTypes(y: number): string[] {
    const issues: string[] = [];
    const ranked = rankedOf(y);
    const raw = rawOf(y);
    const density = densityOf(y);
    const neighRank = neighborAvgRanked(y, yearsSet, byYearAgg);
    const neighRawAvg = neighborAvgRaw(y, yearsSet, chartRowsPerYear);
    const prevRank = yearsSet.has(y - 1) ? rankedOf(y - 1) : null;
    const mig = migByYear.get(y);
    const legacyAlbums = aggLegacyPipeline.agg.get(y)?.size ?? 0;
    const rosterSrcPct = rosterSourceMatchPct(y, byYearAgg, albumsWithSourceMatch);

    if (ranked > 0 && ranked < 50) issues.push("under_50_ranked_albums");
    if (ranked === 0 && legacyAlbums > 0) issues.push("billboard_album_pipeline_empty_legacy_has_albums");

    if (
      neighRank !== null &&
      neighRank >= 40 &&
      ranked < neighRank * 0.45 &&
      ranked < Math.max(45, neighRank * 0.55)
    ) {
      issues.push("sharp_drop_vs_neighbor_window");
    }

    if (
      prevRank !== null &&
      prevRank >= 35 &&
      ranked < prevRank * 0.42 &&
      ranked + 15 < prevRank
    ) {
      issues.push("year_over_year_cliff");
    }

    if (ranked > 0 && slotStdev > 0 && ranked > slotMean + 2 * slotStdev) {
      issues.push("unusually_high_ranked_count");
    }

    if (
      ranked >= 8 &&
      densityP10 > 0 &&
      density < Math.min(3, densityP10) &&
      density < densityMedian * 0.55
    ) {
      issues.push("low_billboard_row_density");
    }

    if (
      neighRawAvg !== null &&
      neighRawAvg > 200 &&
      raw < neighRawAvg * 0.28 &&
      ranked > 0
    ) {
      issues.push("weak_weekly_row_import_vs_neighbors");
    }

    if (
      ranked > 0 &&
      legacyAlbums >= Math.max(ranked * 1.38, ranked + 22) &&
      legacyAlbums - ranked >= 18 &&
      (ranked < 85 || raw < ranked * 2.5)
    ) {
      issues.push("legacy_all_chart_albums_much_richer");
    }

    if (mig && Number(mig.raw_weekly_chart_rows_billboard_album_charts_only) === 0 && Number(mig.raw_weekly_chart_rows_all_charts) > 50) {
      issues.push("zero_billboard_album_rows_but_other_charts_present");
    }

    if (
      globalSourcePct !== null &&
      rosterSrcPct !== null &&
      ranked >= 5 &&
      rosterSrcPct + 12 < globalSourcePct &&
      rosterSrcPct < 72
    ) {
      issues.push("roster_source_match_coverage_lags_corpus");
    }

    return issues;
  }

  const inclusion = new Set<number>();
  for (const y of years) {
    if (collectIssueTypes(y).length > 0) inclusion.add(y);
    if (rankedOf(y) > 0 && rankedOf(y) < 50) inclusion.add(y);
    if (y === 2019 || y === 2020 || y === 2021) inclusion.add(y);
    const mig = migByYear.get(y);
    if (
      mig &&
      Number(mig.unique_albums_billboard_album_chart_only) === 0 &&
      Number(mig.unique_albums_all_chart_links) > 0
    ) {
      inclusion.add(y);
    }
  }

  const suspiciousRows: Record<string, string | number>[] = [...inclusion]
    .sort((a, b) => a - b)
    .map((y) => {
      const ranked = rankedOf(y);
      const raw = rawOf(y);
      const neighRank = neighborAvgRanked(y, yearsSet, byYearAgg);
      const devPct =
        neighRank !== null && neighRank > 0 ? ((ranked - neighRank) / neighRank) * 100 : "";
      const issues = collectIssueTypes(y);
      const notesParts: string[] = [];
      const prevRank = yearsSet.has(y - 1) ? rankedOf(y - 1) : null;
      const nextRank = yearsSet.has(y + 1) ? rankedOf(y + 1) : null;
      if (prevRank !== null) notesParts.push(`prior_year_ranked=${prevRank}`);
      if (nextRank !== null) notesParts.push(`next_year_ranked=${nextRank}`);
      notesParts.push(`density=${densityOf(y).toFixed(2)} rows/album`);
      const rsp = rosterSourceMatchPct(y, byYearAgg, albumsWithSourceMatch);
      if (rsp !== null) notesParts.push(`roster_source_match≈${rsp.toFixed(0)}%`);
      const mig = migByYear.get(y);
      if (mig) {
        notesParts.push(
          `legacy_unique_albums=${mig.unique_albums_all_chart_links} billboard_rows_year=${mig.raw_weekly_chart_rows_billboard_album_charts_only}`,
        );
      }
      if ((y === 2019 || y === 2020 || y === 2021) && issues.length === 0) {
        notesParts.push("focus_year_reviewed_no_auto_flags");
      }

      const likely =
        issues.length > 0
          ? issues.join("|")
          : "inspected_no_auto_flags";

      return {
        year: y,
        ranked_album_count: ranked,
        neighboring_year_average: neighRank !== null ? Number(neighRank.toFixed(2)) : "",
        deviation_percent: devPct === "" ? "" : Number(devPct.toFixed(1)),
        raw_chart_rows: raw,
        distinct_albums: ranked,
        likely_issue_type: likely,
        notes: notesParts.join("; "),
      };
    });

  /** Decade rollup for audit */
  const decadeStats = new Map<
    string,
    { years: number[]; sumRank: number; sumDens: number; n: number; weak: number }
  >();
  for (const y of years) {
    const dk = `${Math.floor(y / 10) * 10}s`;
    if (!decadeStats.has(dk)) decadeStats.set(dk, { years: [], sumRank: 0, sumDens: 0, n: 0, weak: 0 });
    const b = decadeStats.get(dk)!;
    const r = rankedOf(y);
    b.years.push(y);
    if (r > 0) {
      b.sumRank += r;
      b.sumDens += densityOf(y);
      b.n += 1;
    }
    if (collectIssueTypes(y).length > 0 || (r > 0 && r < 50)) b.weak += 1;
  }

  const decadeLines = [...decadeStats.entries()]
    .sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10))
    .map(([dk, s]) => {
      const avgRank = s.n ? (s.sumRank / s.n).toFixed(1) : "—";
      const avgDen = s.n ? (s.sumDens / s.n).toFixed(2) : "—";
      const conf =
        s.n && s.sumRank / s.n > 85 && s.weak <= 1
          ? "higher"
          : s.n && (s.sumRank / s.n < 45 || s.weak >= Math.ceil(s.years.length * 0.35))
            ? "lower"
            : "medium";
      return `- **${dk}**: avg ranked albums≈**${avgRank}** · avg density≈**${avgDen}** · chart years=${s.years.length} · weak/sparse flags≈${s.weak} · confidence≈**${conf}**`;
    });

  const topNames = [...chartNameTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const chartNameLines = topNames.map(([k, v]) => `- \`${k}\`: ${v} rows (all-time in stream)`);

  const focusLines = [2019, 2020, 2021].map((y) => {
    if (!yearsSet.has(y)) {
      return `- **${y}**: *(not in chart-fed year span — no \`retroverse_chart_appearances\` rows calendar-bucketed to this year in this corpus)*`;
    }
    const row = suspiciousRows.find((r) => Number(r.year) === y);
    return row
      ? `- **${y}**: ranked=${row.ranked_album_count}, raw_rows=${row.raw_chart_rows}, issues=\`${row.likely_issue_type}\` — ${row.notes}`
      : `- **${y}**: (no data)`;
  });

  const under50 = years.filter((y) => rankedOf(y) > 0 && rankedOf(y) < 50).sort((a, b) => a - b);

  const repairPriorities = [
    "1. **Billboard weekly import gaps** — prioritize years with `weak_weekly_row_import_vs_neighbors`, `year_over_year_cliff`, or very low `raw_chart_rows` while neighbors are healthy (`retroverse_chart_appearances` / `billboard200:chart-history`).",
    "2. **Chart name / gate mismatches** — inspect global `chart_name` distribution below; rows that never pass `retroverseAlbumChartAppearances()` behave like missing album-chart history.",
    "3. **Album linkage** — years with `legacy_all_chart_albums_much_richer` or `billboard_album_pipeline_empty_legacy_has_albums` suggest Hot-100 or other charts still link to albums while Billboard album-chart rows or anchors are missing.",
    "4. **Source match coverage** — when `roster_source_match_coverage_lags_corpus` appears, enrichment may be incomplete for that cohort (heuristic only; verify in `retroverse_source_matches`).",
    "5. **Sparse roster + normal rows** — `low_billboard_row_density` can indicate duplicate week keys, collapsed IDs, or ingestion deduping; compare `weekly_chart_rows_for_album_this_year` in per-year CSVs.",
  ];

  const strongestDecades = [...decadeStats.entries()]
    .filter(([, s]) => s.n > 0)
    .sort((a, b) => b[1].sumRank / b[1].n - a[1].sumRank / a[1].n)
    .slice(0, 3)
    .map(([dk]) => dk);
  const weakestDecades = [...decadeStats.entries()]
    .filter(([, s]) => s.n > 0)
    .sort((a, b) => a[1].sumRank / a[1].n - b[1].sumRank / b[1].n)
    .slice(0, 3)
    .map(([dk]) => dk);

  const auditMd =
    `# Retroverse Rank — historical coverage audit\n\n` +
    `Generated ${new Date().toISOString().slice(0, 10)} · **inspection / heuristics only** (no ranking or traversal changes).\n\n` +
    `## Corpus snapshot\n\n` +
    `- Dimension rows processed: **${chartRowsLen}** · Billboard album-chart rows (rank pipeline): **${billboardAlbumChartRowCount}**\n` +
    `- Calendar years (ranked pipeline): **${years.length}**\n` +
    `- Distinct albums (rank pipeline): **${allAlbumIds.length}**\n` +
    (globalSourcePct !== null
      ? `- Album-level **source_match** coverage (any match): **${globalSourcePct.toFixed(1)}%** of charted albums\n\n`
      : allAlbumIds.length === 0
        ? "- Album-level **source_match**: *n/a — no charted albums*\n\n"
        : "- Album-level **source_match** coverage: *(not read — Supabase error or blocked)*\n\n") +
    `## Strongest coverage eras (by avg ranked albums / decade)\n\n` +
    (strongestDecades.length ? strongestDecades.map((d) => `- ${d}`).join("\n") : "- *(insufficient data)*") +
    `\n\n## Weakest eras\n\n` +
    (weakestDecades.length ? weakestDecades.map((d) => `- ${d}`).join("\n") : "- *(insufficient data)*") +
    `\n\n## Confidence by decade (automated)\n\n` +
    decadeLines.join("\n") +
    `\n\n` +
    `## Suspicious / focus years (2019–2021 + auto flags)\n\n` +
    focusLines.join("\n") +
    `\n\n## All years under 50 ranked albums\n\n` +
    (under50.length ? under50.map((y) => `- **${y}**: ${rankedOf(y)} albums`).join("\n") : "- *(none)*") +
    `\n\n## Chart name volume (malformed / unexpected gate hints)\n\n` +
    "Top values seen while streaming appearances (not per-year):\n\n" +
    (chartNameLines.length ? chartNameLines.join("\n") : "- *(no tally)*") +
    `\n\n## Classifier tokens (\`likely_issue_type\`)\n\n` +
    "| Token | Interpretation |\n" +
    "|-------|----------------|\n" +
    "| `under_50_ranked_albums` | Small roster vs typical modern Billboard years |\n" +
    "| `sharp_drop_vs_neighbor_window` | Much lower than adjacent calendar years |\n" +
    "| `year_over_year_cliff` | Sudden drop from prior year |\n" +
    "| `unusually_high_ranked_count` | Outlier vs global mean+2σ |\n" +
    "| `low_billboard_row_density` | Few weekly rows per roster album |\n" +
    "| `weak_weekly_row_import_vs_neighbors` | Raw weekly rows far below neighbors |\n" +
    "| `legacy_all_chart_albums_much_richer` | Many albums still reachable via non–album-chart rows |\n" +
    "| `billboard_album_pipeline_empty_legacy_has_albums` | Album-chart filter empty; legacy graph still has albums |\n" +
    "| `zero_billboard_album_rows_but_other_charts_present` | Other chart rows exist; album-chart slice empty |\n" +
    "| `roster_source_match_coverage_lags_corpus` | Roster has fewer matched albums than corpus average |\n" +
    "| `inspected_no_auto_flags` | Included for focus-year review only |\n" +
    `\n` +
    `## Recommended repair priorities\n\n` +
    repairPriorities.map((x) => `${x}`).join("\n") +
    `\n\n## Artefact\n\n` +
    `Machine-readable table: \`retroverse_rank_suspicious_years.csv\`.\n`;

  return { suspiciousRows, auditMd };
}

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (anon key OK for read-mostly).",
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await mkdir(BY_YEAR_DIR, { recursive: true });

  const legacyState: YearAggState = { agg: new Map(), chartRowsPerYear: new Map() };
  const albumState: YearAggState = { agg: new Map(), chartRowsPerYear: new Map() };
  const streamStats = {
    totalRawRows: 0,
    billboardAlbumPipelineRows: 0,
    chartNameTally: new Map<string, number>(),
  };

  process.stderr.write("[rank-inspection] Streaming chart appearances (SQL RPC, by year)…\n");
  await streamAllChartAppearancesIntoAggregates(supabase, legacyState, albumState, streamStats);

  const chartRowsLen = streamStats.totalRawRows;
  const billboardAlbumChartRowCount = streamStats.billboardAlbumPipelineRows;
  process.stderr.write(
    `[rank-inspection] Raw chart rows: ${chartRowsLen} · billboard_album_chart_rows_for_rank_pipeline=${billboardAlbumChartRowCount}\n`,
  );
  if (billboardAlbumChartRowCount === 0 && chartRowsLen > 0) {
    const tip = [...streamStats.chartNameTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
    process.stderr.write(
      `[rank-inspection] DIAGNOSTIC chart_name tally (top 20): ${JSON.stringify(Object.fromEntries(tip))}\n`,
    );
  }

  const aggLegacyPipeline = legacyState;
  const aggAlbumCharts = albumState;
  const { agg: byYearAgg, chartRowsPerYear } = aggAlbumCharts;

  const distinctLegacyAlbumIds = distinctAlbumIdsInAggPipe(aggLegacyPipeline.agg);
  const distinctRankAlbumIds = distinctAlbumIdsInAggPipe(aggAlbumCharts.agg);

  const migrationYears = new Set([...aggLegacyPipeline.agg.keys(), ...aggAlbumCharts.agg.keys()]);
  const migrationByYearRows: Record<string, string | number>[] = [...migrationYears]
    .sort((a, b) => a - b)
    .map((year) => {
      const lg = aggLegacyPipeline.agg.get(year)?.size ?? 0;
      const nw = aggAlbumCharts.agg.get(year)?.size ?? 0;
      return {
        year,
        unique_albums_all_chart_links: lg,
        unique_albums_billboard_album_chart_only: nw,
        delta_unique_albums: nw - lg,
        raw_weekly_chart_rows_all_charts: aggLegacyPipeline.chartRowsPerYear.get(year) ?? 0,
        raw_weekly_chart_rows_billboard_album_charts_only: aggAlbumCharts.chartRowsPerYear.get(year) ?? 0,
      };
    });

  await writeFile(
    path.join(OUT_DIR, "retroverse_rank_source_migration_by_year.csv"),
    toCsv(
      [
        "year",
        "unique_albums_all_chart_links",
        "unique_albums_billboard_album_chart_only",
        "delta_unique_albums",
        "raw_weekly_chart_rows_all_charts",
        "raw_weekly_chart_rows_billboard_album_charts_only",
      ],
      migrationByYearRows,
    ),
    "utf8",
  );

  const baselineBbSlotsByYear = loadBillboardAlbumBaselineByYear();
  const anchorCompareRows: Record<string, string | number>[] = [];
  let baselineBbSlotSum = 0;
  let correctedBbSlotSum = 0;
  for (const r of migrationByYearRows) {
    const y = Number(r.year);
    const corrected = Number(r.unique_albums_billboard_album_chart_only);
    const previous = baselineBbSlotsByYear.get(y) ?? 0;
    baselineBbSlotSum += previous;
    correctedBbSlotSum += corrected;
    anchorCompareRows.push({
      year: y,
      previous_new_count: previous,
      corrected_count: corrected,
      delta: corrected - previous,
    });
  }
  await writeFile(
    path.join(OUT_DIR, "retroverse_rank_bb200_anchor_migration_by_year.csv"),
    toCsv(["year", "previous_new_count", "corrected_count", "delta"], anchorCompareRows),
    "utf8",
  );

  const threeWayByYear: Record<string, string | number>[] = migrationByYearRows.map((r) => ({
    year: Number(r.year),
    hot100_derived: Number(r.unique_albums_all_chart_links),
    broken_anchor_track: baselineBbSlotsByYear.get(Number(r.year)) ?? 0,
    corrected_album_anchor: Number(r.unique_albums_billboard_album_chart_only),
  }));
  await writeFile(
    path.join(OUT_DIR, "retroverse_rank_three_way_by_year.csv"),
    toCsv(["year", "hot100_derived", "broken_anchor_track", "corrected_album_anchor"], threeWayByYear),
    "utf8",
  );

  const migrationShrinkMost = [...migrationByYearRows].sort(
    (a, b) => Number(a.delta_unique_albums) - Number(b.delta_unique_albums),
  );
  const migrationSwellOnly = [...migrationByYearRows]
    .filter((r) => Number(r.delta_unique_albums) > 0)
    .sort((a, b) => Number(b.delta_unique_albums) - Number(a.delta_unique_albums));
  const yearsRankEmptyOtherHadAlbums =
    migrationByYearRows.filter(
      (r) => Number(r.unique_albums_billboard_album_chart_only) === 0 && Number(r.unique_albums_all_chart_links) > 0,
    ).length;

  const migrationMd =
    `# Retroverse Rank — Billboard album chart migration\n\n` +
    `## Data prerequisite\n\n` +
    `- Inspect stderr **DIAGNOSTIC chart_name tally**. If corpus is **Hot 100 only**, Retroverse Rank is intentionally **empty until Billboard 200 history lands**.\n` +
    "- Load weekly Billboard 200 rows into `retroverse_chart_appearances` (chart_name `Billboard 200`) via npm run `billboard200:chart-history` — see `scripts/backfill_billboard200_chart_appearances.ts` for env/service-role requirements.\n\n" +
    `Compared **legacy** derivation (every \`retroverse_chart_appearances\` row projecting to albums through \`retroverse_tracks.retroverse_album_id\`) ` +
    `vs **album-only Billboard** derivation (\`retroverseAlbumChartAppearances()\` from \`lib/billboard-album-chart-appearance.ts\`).\n\n` +
    `## Totals\n\n` +
    `- Raw chart dimension rows fetched: **${chartRowsLen}**\n` +
    `- Rows matching Billboard album-chart gate (used now for rank): **${billboardAlbumChartRowCount}**\n` +
    `- Distinct albums (any legacy chart link): **${distinctLegacyAlbumIds.size}**\n` +
    `- Distinct albums (Billboard album chart rows only — **Retroverse Rank now**): **${distinctRankAlbumIds.size}**\n` +
    `- Calendar years with ≥1 Billboard-album-ranked album: **${[...migrationByYearRows].filter((r) => Number(r.unique_albums_billboard_album_chart_only) > 0).length}**\n` +
    `- Years non-empty legacy / empty Billboard-album traversal: **${yearsRankEmptyOtherHadAlbums}** (fallback to release-year ordering if user lands there).\n\n` +
    `## Largest reductions (unique albums: new − legacy)\n\n` +
    (migrationShrinkMost.length
      ? migrationShrinkMost
          .slice(0, 12)
          .map(
            (r) =>
              `- **${r.year}**: Δ **${r.delta_unique_albums}** (${r.unique_albums_billboard_album_chart_only} billboard-album albums vs ${r.unique_albums_all_chart_links} legacy)`,
          )
          .join("\n")
      : "- (none)") +
    `\n\n## Years with more albums under Billboard-album filtering (Δ > 0)\n\n` +
    (migrationSwellOnly.length
      ? migrationSwellOnly.slice(0, 10).map((r)=>`- **${r.year}**: +${r.delta_unique_albums}`).join("\n") 
      : "- (none)") +
    `\n\n## Editorial read\n\n` +
    `Retroverse traversal is now keyed to **US-focused Billboard album chart families** (200 / Top Album stacks) instead of projecting **singles/other charts onto albums**. `+
    `Roster depth **drops** versus the old pipe wherever Hot 100 (and similar) was inflating perceived \"album breadth\".` +
    ` See \`retroverse_rank_source_migration_by_year.csv\` for deltas per year.\n`;

  await writeFile(path.join(OUT_DIR, "retroverse_rank_source_migration.md"), migrationMd, "utf8");

  const years = [...byYearAgg.keys()].sort((a, b) => a - b);
  /** album -> set of years charted */
  const albumYears = new Map<string, Set<number>>();
  for (const [y, m] of byYearAgg) {
    for (const albumId of m.keys()) {
      if (!albumYears.has(albumId)) albumYears.set(albumId, new Set());
      albumYears.get(albumId)!.add(y);
    }
  }

  const multiYearAlbums = [...albumYears.entries()].filter(([, ys]) => ys.size >= 2);

  /** Meta for ALL albums touching charts */
  const allAlbumIds = [...albumYears.keys()];
  process.stderr.write(`[rank-inspection] Resolving titles for ${allAlbumIds.length} distinct albums…\n`);
  const meta = await loadAlbumArtistMeta(supabase, allAlbumIds);

  let albumsWithSourceMatch: Set<string> | null = null;
  try {
    process.stderr.write("[rank-inspection] Album source_match coverage (entity_type=album)…\n");
    albumsWithSourceMatch = await fetchAlbumSourceMatchIds(supabase, allAlbumIds);
  } catch (e) {
    process.stderr.write(`[rank-inspection] source_match scan skipped: ${String(e)}\n`);
    albumsWithSourceMatch = null;
  }

  /** One ranked roster per calendar year (portal sort); reused for exports and anomaly scan. */
  const rankedByYear = new Map<number, YearAlbumAgg[]>();
  for (const year of years) {
    rankedByYear.set(year, rankAppearances(byYearAgg.get(year)!, meta));
  }

  type SummaryRow = Record<string, string | number>;
  const summaryRows: SummaryRow[] = [];
  const inventoryRows: Record<string, string | number>[] = [];
  const albumCountsRows: Record<string, string | number>[] = [];
  /** Master combined export rows (portal column set; includes year column). */
  const allAppearancesCsvRows: Record<string, unknown>[] = [];

  function chartDensity(rankedSlots: number, rawRowsYear: number): number {
    if (!rankedSlots) return 0;
    return rawRowsYear / rankedSlots;
  }

  for (const year of years) {
    const ranked = rankedByYear.get(year)!;
    const uniqueAlbums = ranked.length;
    const totalAlbumAppearancesPortal = ranked.length;
    let multiThisYear = 0;
    for (const row of ranked) {
      const ny = albumYears.get(row.albumId)?.size ?? 0;
      if (ny >= 2) multiThisYear++;
    }

    const top = ranked[0];
    let topArtist = "";
    let topAlbum = "";
    let topPeak = "";
    let topAlbumId = "";
    if (top) {
      const m = meta.get(top.albumId);
      topArtist = m?.canonical_artist_name ?? "";
      topAlbum = m?.canonical_album_title ?? "";
      topPeak = String(top.peakChartPosition);
      topAlbumId = top.albumId;
    }

    const rankedOneTies =
      ranked.length > 1
        ? ranked.filter((x) => x.peakChartPosition === ranked[0]!.peakChartPosition).length
        : 0;

    const albumsPeakOne = ranked.filter((x) => x.peakChartPosition === 1).length;

    const topAgg = ranked[0] ?? null;
    const lastAgg = ranked.length ? ranked[ranked.length - 1] ?? null : null;
    const longAgg = pickLongestPersistingThisYear(ranked, albumYears);
    const nyLong = longAgg ? (albumYears.get(longAgg.albumId)?.size ?? 0) : 0;

    const firstByCalendar = pickEarliestFirstChartYear(ranked);
    const lastByCalendar = pickLatestLastChartYear(ranked);

    const rawYR = chartRowsPerYear.get(year) ?? 0;
    inventoryRows.push({
      year,
      total_ranked_album_appearances: uniqueAlbums,
      total_unique_albums: uniqueAlbums,
      total_albums_peak_position_1: albumsPeakOne,
      albums_that_also_chart_in_other_years: multiThisYear,
      chart_raw_weekly_rows_in_year: rawYR,
      chart_density_weekly_rows_per_unique_album: Number(chartDensity(uniqueAlbums, rawYR).toFixed(4)),
      /** Portal traversal begins here (Retroverse Rank #1 for the year). */
      top_ranked_album_traversal_rank_1: topAgg ? albumSummaryLine(meta, topAgg, true) : "",
      /** Earliest weekly first_chart_date observed for any album rostered this year (not necessarily rank #1). */
      first_calendar_entrant_album: firstByCalendar ? albumSummaryLine(meta, firstByCalendar, true) : "",
      /** Among albums charting this year, the one spanning the most distinct chart years globally (tie: higher traversal rank). */
      longest_persistent_album_cross_year_span:
        longAgg && nyLong
          ? `${albumSummaryLine(meta, longAgg, true)} · ${nyLong} distinct chart years`
          : "",
      /** Final slot in traversal order for this year (#N ranked album). */
      last_ranked_album_traversal_bottom: lastAgg ? albumSummaryLine(meta, lastAgg, true) : "",
      /** Latest last_chart_date in the roster (weekly observation window closes here for this calendar year cohort). */
      last_calendar_observer_album: lastByCalendar
        ? `${albumSummaryLine(meta, lastByCalendar, false)} · last_chart=${lastByCalendar.lastChartDate}`
        : "",
    });

    albumCountsRows.push({
      year,
      ranked_album_count: uniqueAlbums,
      unique_album_count: uniqueAlbums,
      chart_weekly_rows: rawYR,
    });

    summaryRows.push({
      year,
      chart_raw_rows_in_year: chartRowsPerYear.get(year) ?? 0,
      total_ranked_slots: totalAlbumAppearancesPortal,
      unique_albums: uniqueAlbums,
      albums_with_activity_in_multiple_years: multiThisYear,
      rank_one_album_id: topAlbumId,
      rank_one_peak_position: topPeak,
      rank_one_artist: topArtist,
      rank_one_title: topAlbum,
      albums_tied_lowest_peak_same_as_rank_one: rankedOneTies,
    });

    /** Per-year CSV */
    const yearRows: Record<string, unknown>[] = ranked.map((r, i) => {
      const mm = meta.get(r.albumId);
      return {
        year,
        rank: i + 1,
        artist: mm?.canonical_artist_name ?? "",
        album: mm?.canonical_album_title ?? "",
        peak_chart_position: r.peakChartPosition,
        weeks_on_chart: r.maxWeeksOnChart || "",
        weekly_chart_rows_for_album_this_year: r.chartRowCount,
        first_chart_date: r.firstChartDate,
        last_chart_date: r.lastChartDate,
        retroverse_album_id: r.albumId,
      };
    });

    allAppearancesCsvRows.push(...yearRows);

    await writeFile(
      path.join(BY_YEAR_DIR, `${year}_ranked_appearances.csv`),
      toCsv(
        [
          "year",
          "rank",
          "artist",
          "album",
          "peak_chart_position",
          "weeks_on_chart",
          "weekly_chart_rows_for_album_this_year",
          "first_chart_date",
          "last_chart_date",
          "retroverse_album_id",
        ],
        yearRows,
      ),
      "utf8",
    );
  }

  const invHeaders = [
    "year",
    "total_ranked_album_appearances",
    "total_unique_albums",
    "total_albums_peak_position_1",
    "albums_that_also_chart_in_other_years",
    "chart_raw_weekly_rows_in_year",
    "chart_density_weekly_rows_per_unique_album",
    "top_ranked_album_traversal_rank_1",
    "first_calendar_entrant_album",
    "longest_persistent_album_cross_year_span",
    "last_ranked_album_traversal_bottom",
    "last_calendar_observer_album",
  ];

  await writeFile(path.join(OUT_DIR, "retroverse_year_inventory.csv"), toCsv(invHeaders, inventoryRows), "utf8");

  await writeFile(
    path.join(OUT_DIR, "retroverse_year_album_counts.csv"),
    toCsv(["year", "ranked_album_count", "unique_album_count", "chart_weekly_rows"], albumCountsRows),
    "utf8",
  );

  await writeFile(
    path.join(OUT_DIR, "retroverse_all_ranked_appearances.csv"),
    toCsv(
      [
        "year",
        "rank",
        "artist",
        "album",
        "peak_chart_position",
        "weeks_on_chart",
        "weekly_chart_rows_for_album_this_year",
        "first_chart_date",
        "last_chart_date",
        "retroverse_album_id",
      ],
      allAppearancesCsvRows,
    ),
    "utf8",
  );

  /** Top ranks per year (1–10) — quick scan without opening each yearly CSV. */
  const topBand: Record<string, unknown>[] = [];
  for (const year of years) {
    const ranked = rankedByYear.get(year)!.slice(0, 10);
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i]!;
      const mm = meta.get(r.albumId);
      topBand.push({
        year,
        rank: i + 1,
        retroverse_album_id: r.albumId,
        artist: mm?.canonical_artist_name ?? "",
        album: mm?.canonical_album_title ?? "",
        peak_chart_position: r.peakChartPosition,
        weekly_rows_this_year_for_album: r.chartRowCount,
      });
    }
  }

  await writeFile(
    path.join(OUT_DIR, "top_ranks_band_1_10.csv"),
    toCsv(
      [
        "year",
        "rank",
        "retroverse_album_id",
        "artist",
        "album",
        "peak_chart_position",
        "weekly_rows_this_year_for_album",
      ],
      topBand,
    ),
    "utf8",
  );

  await writeFile(
    path.join(OUT_DIR, "summary_by_year.csv"),
    toCsv(
      [
        "year",
        "chart_raw_rows_in_year",
        "total_ranked_slots",
        "unique_albums",
        "albums_with_activity_in_multiple_years",
        "rank_one_album_id",
        "rank_one_peak_position",
        "rank_one_artist",
        "rank_one_title",
        "albums_tied_lowest_peak_same_as_rank_one",
      ],
      summaryRows,
    ),
    "utf8",
  );

  /** Longest persistence (distinct calendar years charted). */
  const persistence = multiYearAlbums
    .map(([albumId, ys]) => ({
      retroverse_album_id: albumId,
      distinct_years: ys.size,
      years: [...ys].sort((a, b) => a - b).join(";"),
      ...(meta.get(albumId) ?? { canonical_artist_name: "", canonical_album_title: "" }),
    }))
    .sort((a, b) => b.distinct_years - a.distinct_years);

  await writeFile(
    path.join(OUT_DIR, "longest_persistent_albums.csv"),
    toCsv(
      ["retroverse_album_id", "distinct_years", "canonical_artist_name", "canonical_album_title", "years"],
      persistence.slice(0, 500),
    ),
    "utf8",
  );

  /** Anomalies (inspection hints). */
  const slotCounts = years.map((y) => (byYearAgg.get(y)?.size ?? 0));
  const mean = slotCounts.length ? slotCounts.reduce((s, x) => s + x, 0) / slotCounts.length : 0;
  const variance =
    slotCounts.length > 1
      ? slotCounts.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (slotCounts.length - 1)
      : 0;
  const stdev = Math.sqrt(variance);
  const largeThreshold = mean + 2 * stdev;
  const smallThreshold = Math.max(1, Math.floor(mean - stdev));

  const anomalyRows: Record<string, string>[] = [];

  for (const y of years) {
    const n = byYearAgg.get(y)?.size ?? 0;
    if (n >= largeThreshold && n > mean * 2) {
      anomalyRows.push({
        kind: "unusually_large_ranked_slots",
        year: String(y),
        detail: `ranked_slots=${n} (mean≈${mean.toFixed(1)} stdev≈${stdev.toFixed(1)})`,
      });
    }
    if (n <= smallThreshold && n < Math.max(5, Math.floor(mean * 0.15))) {
      anomalyRows.push({
        kind: "sparse_chart_year_low_album_slots",
        year: String(y),
        detail: `ranked_slots=${n} (mean≈${mean.toFixed(1)})`,
      });
    }

    const ranked = rankedByYear.get(y)!;
    const tiesRank1 =
      ranked.length > 0 ? ranked.filter((x) => x.peakChartPosition === ranked[0]!.peakChartPosition).length : 0;
    if (tiesRank1 >= 8) {
      anomalyRows.push({
        kind: "many_albums_share_rank_one_peak",
        year: String(y),
        detail: `${tiesRank1} albums share peak ${ranked[0]?.peakChartPosition ?? ""}`,
      });
    }

    /** Single row album with very harsh peak (#1 vs many rows elsewhere) skipped — needs cross-year compare */
  }

  await writeFile(
    path.join(OUT_DIR, "anomalies_hints.csv"),
    toCsv(["kind", "year", "detail"], anomalyRows),
    "utf8",
  );

  const { suspiciousRows, auditMd } = computeSuspiciousYearExport({
    years,
    byYearAgg,
    chartRowsPerYear,
    migrationByYearRows,
    aggLegacyPipeline,
    slotMean: mean,
    slotStdev: stdev,
    albumsWithSourceMatch,
    allAlbumIds,
    chartNameTally: streamStats.chartNameTally,
    chartRowsLen,
    billboardAlbumChartRowCount,
  });
  await writeFile(
    path.join(OUT_DIR, "retroverse_rank_suspicious_years.csv"),
    toCsv(
      [
        "year",
        "ranked_album_count",
        "neighboring_year_average",
        "deviation_percent",
        "raw_chart_rows",
        "distinct_albums",
        "likely_issue_type",
        "notes",
      ],
      suspiciousRows,
    ),
    "utf8",
  );
  await writeFile(path.join(OUT_DIR, "retroverse_rank_coverage_audit.md"), auditMd, "utf8");
  process.stderr.write(
    "[rank-inspection] Wrote retroverse_rank_suspicious_years.csv and retroverse_rank_coverage_audit.md\n",
  );

  /** Year inventory narrative (editorial; same numbers as `retroverse_year_inventory.csv`). */
  const totalAppearanceSlotsAcrossYears = inventoryRows.reduce(
    (s, r) => s + Number(r.total_ranked_album_appearances),
    0,
  );
  const byRankedDesc = [...inventoryRows].sort(
    (a, b) => Number(b.total_ranked_album_appearances) - Number(a.total_ranked_album_appearances),
  );
  const byRankedAsc = [...inventoryRows].sort(
    (a, b) => Number(a.total_ranked_album_appearances) - Number(b.total_ranked_album_appearances),
  );
  const byDensityDesc = [...inventoryRows].sort(
    (a, b) =>
      Number(b.chart_density_weekly_rows_per_unique_album) - Number(a.chart_density_weekly_rows_per_unique_album),
  );
  const sparseFlagYears = new Set(
    anomalyRows.filter((a) => a.kind === "sparse_chart_year_low_album_slots").map((a) => Number(a.year)),
  );
  const manyOnesFlagYears = new Set(
    anomalyRows.filter((a) => a.kind === "many_albums_share_rank_one_peak").map((a) => Number(a.year)),
  );
  const invWithPeakShare = inventoryRows.map((r) => ({
    r,
    peak1Share:
      Number(r.total_ranked_album_appearances) > 0
        ? Number(r.total_albums_peak_position_1) / Number(r.total_ranked_album_appearances)
        : 0,
  }));
  const dominatedByPeakOne = [...invWithPeakShare]
    .sort((a, b) => b.peak1Share - a.peak1Share)
    .slice(0, 15);

  const qCut = Math.max(1, Math.floor(inventoryRows.length * 0.25));
  const topQuarterYears = new Set(byRankedDesc.slice(0, qCut).map((x) => x.year));
  const topQuarterDensityYears = new Set(byDensityDesc.slice(0, qCut).map((x) => x.year));
  const compositeStrong = inventoryRows
    .filter((row) => topQuarterYears.has(row.year) && topQuarterDensityYears.has(row.year))
    .sort((a, b) => Number(b.total_ranked_album_appearances) - Number(a.total_ranked_album_appearances));

  const inventoryMd =
    `# Retroverse Rank — yearly inventory\n\n` +
    `Generated ${new Date().toISOString().slice(0, 10)} · inspection only · **no** ranking rules changed.\n\n` +
    `## Global scale\n\n` +
    `- **Billboard‑album chart rows feeding rank:** **${billboardAlbumChartRowCount}** (of **${chartRowsLen}** \`retroverse_chart_appearances\` dimension rows fetched)\n` +
    `- **Calendar years represented (chart-fed):** ${years.length} (**${years[0] ?? "?"}**–**${years[years.length - 1] ?? "?"}**)\n` +
    `- **Distinct albums with any chart year:** ${albumYears.size}\n` +
    `- **Sum of year-level ranked slots** (albums “in the stack” per year, **with replays** across years): **${totalAppearanceSlotsAcrossYears}**\n` +
    `- **Albums charting ≥ 2 years:** ${multiYearAlbums.length}\n\n` +
    `Column semantics in \`retroverse_year_inventory.csv\`:\n\n` +
    `- **Top / last ranked** refer to **Retroverse traversal ends** for that year (**rank 1** and **bottom** of the ordered list).\n` +
    `- **Calendar first / calendar last** rows use **earliest \`first_chart_date\`** and **latest \`last_chart_date\`** among albums rostered that year (**not** the same as traversal rank).\n` +
    `- **Longest persistent** = album in that year’s roster with the **largest count of distinct calendar years** charted corpus-wide.\n\n` +
    `## Largest years (by unique albums charting that year)\n\n` +
    byRankedDesc
      .slice(0, 10)
      .map(
        (r) =>
          `- **${r.year}**: **${r.total_ranked_album_appearances}** albums · **${r.chart_raw_weekly_rows_in_year}** weekly rows · density **${r.chart_density_weekly_rows_per_unique_album}**`,
      )
      .join("\n") +
    `\n\n` +
    `## Smallest years (same metric)\n\n` +
    byRankedAsc
      .slice(0, 10)
      .map(
        (r) =>
          `- **${r.year}**: **${r.total_ranked_album_appearances}** albums · **${r.chart_raw_weekly_rows_in_year}** rows · density **${r.chart_density_weekly_rows_per_unique_album}**`,
      )
      .join("\n") +
    `\n\n` +
    `## Strongest chart-density years (weekly rows ÷ unique albums)\n\n` +
    `- Higher density ≈ **more weekly chart rows per distinct album identity** that calendar slice (busier churn).\n\n` +
    byDensityDesc
      .slice(0, 12)
      .map((r) => `- **${r.year}**: density **${r.chart_density_weekly_rows_per_unique_album}** · albums **${r.total_ranked_album_appearances}** · rows **${r.chart_raw_weekly_rows_in_year}**`)
      .join("\n") +
    `\n\n` +
    `## Suspiciously low roster depth\n\n` +
    (sparseFlagYears.size === 0
      ? "- *(No years matched the automated “sparse” heuristic; see `retroverse_year_inventory.csv` for naked counts.)*\n"
      : [...sparseFlagYears]
          .sort((a, b) => a - b)
          .map((y) => {
            const row = inventoryRows.find((r) => r.year === y);
            return `- **${y}**: **${row?.total_ranked_album_appearances ?? "?"}** albums · heuristic flag · detail in \`anomalies_hints.csv\``;
          })
          .join("\n")) +
    `\n\n` +
    `## Years overloaded with “peak = #1” albums\n\n` +
    `- Many **#1 peak** albums share the top bracket — traversal resolves ties by **weeks**, **density**, and **timing** (\`portal-year-rank-sort\`).\n` +
    `- Years below have the **highest share** of roster at **peak position 1** (may still feel “crowded” at rank 1 even after tie logic):\n\n` +
    dominatedByPeakOne
      .map(({ r, peak1Share }) => {
        const flag = sparseFlagYears.has(Number(r.year)) ? " ⚠ sparse" : "";
        const m1 = manyOnesFlagYears.has(Number(r.year)) ? " · many ties at rank‑1 bracket" : "";
        return `- **${r.year}**: **${(peak1Share * 100).toFixed(1)}%** (#1‑peak albums: ${r.total_albums_peak_position_1} / ${r.total_ranked_album_appearances})${flag}${m1}`;
      })
      .join("\n") +
    `\n\n` +
    `## Years appearing “historically strongest” under a simple composite\n\n` +
    `- **Heuristic:** years in **top quartile** for both **album roster depth** _and_ **weekly‑row density**. These read as chart‑busy *and* wide for Retroverse traversal.\n\n` +
    (compositeStrong.length
      ? compositeStrong
          .map(
            (r) =>
              `- **${r.year}**: albums **${r.total_ranked_album_appearances}** · rows **${r.chart_raw_weekly_rows_in_year}** · density **${r.chart_density_weekly_rows_per_unique_album}**`,
          )
          .join("\n")
      : "- *(Intersection empty — relax quartile thresholds manually if needed.)*\n") +
    `\n\n` +
    `## Artefacts\n\n` +
    `- Migration vs legacy (all-chart) derivation: \`retroverse_rank_source_migration_by_year.csv\` · \`retroverse_rank_source_migration.md\`\n` +
    `- Coverage audit: \`retroverse_rank_suspicious_years.csv\` · \`retroverse_rank_coverage_audit.md\`\n` +
    `- \`retroverse_year_inventory.csv\` · \`retroverse_year_album_counts.csv\` · \`retroverse_all_ranked_appearances.csv\`\n` +
    `- Per-year ranked exports: \`by_year/\`, files named \`<calendar-year>_ranked_appearances.csv\` (same columns as the portal inspection export).\n`;

  await writeFile(path.join(OUT_DIR, "retroverse_year_inventory.md"), inventoryMd, "utf8");

  const legacySkippedBb200 = readLegacySkippedBb200RowsNoTrack();
  const chartYearsWithBbAlbumRank = migrationByYearRows.filter(
    (r) => Number(r.unique_albums_billboard_album_chart_only) > 0,
  ).length;
  const avgCorrectedBbSlotsPerActiveYear =
    chartYearsWithBbAlbumRank > 0 ? correctedBbSlotSum / chartYearsWithBbAlbumRank : 0;
  const avgBaselineBbSlotsPerActiveYear =
    chartYearsWithBbAlbumRank > 0 ? baselineBbSlotSum / chartYearsWithBbAlbumRank : 0;
  const largestBbAnchorGains = [...anchorCompareRows]
    .sort((a, b) => Number(b.delta) - Number(a.delta))
    .slice(0, 15);

  /** Markdown summary */
  const topPersist = persistence.slice(0, 25);
  const largestYears = [...summaryRows]
    .sort((a, b) => Number(b.total_ranked_slots) - Number(a.total_ranked_slots))
    .slice(0, 10);
  const sparseYears = [...summaryRows].filter((r) =>
    anomalyRows.some(
      (a) =>
        a.kind === "sparse_chart_year_low_album_slots" &&
        a.year === String(r.year),
    ),
  );

  const trustBullets =
    "**Trust read (inspection-only, heuristic):**\n\n" +
    "- Source: **`retroverse_chart_appearances`** where **`chart_name`** passes **`retroverseAlbumChartAppearances()`** (US Billboard **album** lists). Prefer **`retroverse_album_id`** on the chart row; otherwise resolve album via **`retroverse_tracks`** (`lib/chart-appearance-album-id.ts`).\n" +
    "- **Retroverse Rank order** (per calendar year): **best `chart_position`** → **weeks DESC** → **weekly row-count DESC** → **earliest `chart_date`** → **artist/album**/id (`comparePortalYearAlbumRank`).\n" +
    "- **Sparse years**: see `anomalies_hints.csv` and § “Low counts.” Vs prior all-chart derivation: **`retroverse_rank_source_migration*.`**\n\n";

  const anomalyCounts = new Map<string, number>();
  for (const a of anomalyRows) anomalyCounts.set(a.kind, (anomalyCounts.get(a.kind) ?? 0) + 1);

  const anomaliesSection =
    `## Anomaly hints (automated counts)\n\n` +
    (anomalyCounts.size === 0
      ? "- (none)\n"
      : [...anomalyCounts.entries()].map(([k, n]) => `- **${k}**: ${n} row(s)`).join("\n")) +
    `\n\nSee \`anomalies_hints.csv\` for per-year rows.\n\n`;

  const md = `# Retroverse Rank — inspection (${new Date().toISOString().slice(0, 10)})\n\n` +
    "## Scope\n\n" +
    "- Source: Billboard **album-chart** appearances in **`retroverse_chart_appearances`** (**`retroverseAlbumChartAppearances`** filter). Album identity comes from **`retroverse_album_id`** on the row when present, else **`retroverse_tracks.retroverse_album_id`** (`lib/chart-appearance-album-id.ts`).\n" +
    "- One **aggregation** per (calendar year × album): **peak** = best weekly position; **`weeks_on_chart`** cells = **max** across weekly rows — weekly row totals drive density tie-breaks.\n" +
    "- Exports omit **fallback** traversal years (**zero** Billboard album-chart hits → alphabetical `release_year` ordering).\n\n" +
    "## Files\n\n" +
    "- `SUMMARY.md` (this file)\n" +
    "- `retroverse_rank_source_migration_by_year.csv` · `retroverse_rank_source_migration.md`\n" +
    "- `retroverse_rank_bb200_anchor_migration_by_year.csv` (track-anchored baseline vs corrected per-year album slots)\n" +
    "- `retroverse_rank_three_way_by_year.csv` — **`hot100_derived`** (all chart links) vs **`broken_anchor_track`** (baseline BB200 track-anchored ingest) vs **`corrected_album_anchor`**\n" +
    "- `baseline_track_anchored_unique_albums_by_year.csv` · `legacy_skipped_bb200_rows_no_anchor_track.txt` (pinned baselines for comparison)\n" +
    "- `retroverse_year_inventory.csv` · `retroverse_year_inventory.md`\n" +
    "- `retroverse_year_album_counts.csv` · `retroverse_all_ranked_appearances.csv`\n" +
    "- `summary_by_year.csv`\n" +
    "- `longest_persistent_albums.csv`\n" +
    "- `top_ranks_band_1_10.csv`\n" +
    "- `anomalies_hints.csv`\n" +
    "- `retroverse_rank_suspicious_years.csv` · `retroverse_rank_coverage_audit.md`\n" +
    "- `by_year/<YEAR>_ranked_appearances.csv`\n" +
    "- `index.html` (sortable overview)\n\n" +
    "## Counts\n\n" +
    `- Raw chart dimension rows fetched: **${chartRowsLen}**\n` +
    `- Rows matching Billboard **album-chart** predicate (Retroverse Rank): **${billboardAlbumChartRowCount}**\n` +
    `- Chart-active calendar years: **${years.length}**\n` +
    `- Distinct albums touching charts (any year): **${albumYears.size}**\n` +
    `- Albums charting **≥ 2 distinct years**: **${multiYearAlbums.length}**\n\n` +
    "## Billboard 200 album anchor (vs track-only ingestion)\n\n" +
    (legacySkippedBb200 != null
      ? `- **Weekly Billboard 200 rows dropped in the last track-anchored backfill** (no anchor track): **${legacySkippedBb200}** (\`legacy_skipped_bb200_rows_no_anchor_track.txt\`).\n`
      : "") +
    `- **Per-year unique-album slots (sum over migration years):** **${baselineBbSlotSum}** (baseline snapshot) → **${correctedBbSlotSum}** (after album-direct chart rows + re-run).\n` +
    `- **Years with ≥1 Billboard-album-slot album:** **${chartYearsWithBbAlbumRank}** · avg slots per such year: **${avgCorrectedBbSlotsPerActiveYear.toFixed(2)}** (baseline avg **${avgBaselineBbSlotsPerActiveYear.toFixed(2)}**).\n` +
    `- Per-year table: \`retroverse_rank_bb200_anchor_migration_by_year.csv\`.\n\n` +
    `### Largest per-year gains (corrected − previous)\n\n` +
    (largestBbAnchorGains.some((r) => Number(r.delta) > 0)
      ? largestBbAnchorGains
          .filter((r) => Number(r.delta) > 0)
          .slice(0, 15)
          .map(
            (r) =>
              `- **${r.year}**: Δ **+${r.delta}** → **${r.corrected_count}** albums (was **${r.previous_new_count}**)\n`,
          )
          .join("")
      : "- *(none — baseline missing or no gains)*\n") +
    `\n` +
    trustBullets +
    anomaliesSection +
    "## Largest years (by ranked album slots)\n\n" +
    largestYears.map((r) => `- **${r.year}**: ranked_slots=${r.total_ranked_slots} raw_rows=${r.chart_raw_rows_in_year}`).join("\n") +
    `\n\n` +
    "## Sparse / low-slot years\n\n" +
    (sparseYears.length
      ? sparseYears.map((r) => `- **${r.year}**: ranked_slots=${r.total_ranked_slots}`).join("\n")
      : "- (none flagged by heuristic; see anomalies_hints.csv)") +
    `\n\n` +
    "## Top persisting albums (years)\n\n" +
    topPersist
      .map(
        (p) =>
          `- **${p.canonical_artist_name} — ${p.canonical_album_title}** \`${p.retroverse_album_id}\` — **${p.distinct_years}** years`,
      )
      .join("\n") +
    `\n`;

  await writeFile(path.join(OUT_DIR, "SUMMARY.md"), md, "utf8");

  /** Lightweight sortable HTML for summary CSV */
  const htmlTableRows = summaryRows
    .map(
      (r) =>
        `<tr data-year="${String(r.year)}">${["year","chart_raw_rows_in_year","total_ranked_slots","unique_albums","albums_with_activity_in_multiple_years","albums_tied_lowest_peak_same_as_rank_one"].map((k)=>`<td data-k="${k}">${String(r[k as keyof SummaryRow]).replace(/&/g,"&amp;").replace(/</g,"&lt;")}</td>`).join("")}</tr>`,
    )
    .join("\n");

  const html =
    `<!doctype html>
<html lang="en">
<meta charset="utf-8"/><title>Retroverse Rank inspection</title>
<style>
body{font-family:system-ui,Segoe UI,Roboto,sans-serif;margin:24px;color:#eee;background:#0a0f14;line-height:1.45;}
a{color:#d4af6a;text-decoration:none} a:hover{text-decoration:underline;}
h1{font-size:1.15rem;color:#edc98b;}
table{border-collapse:collapse;margin:16px 0;font-size:12px;width:max-content;max-width:100%;}
thead th{padding:9px 10px;text-align:left;cursor:pointer;user-select:none;background:#121a23;border-bottom:1px solid #2a3744;color:#cfa86a;text-transform:uppercase;letter-spacing:.06em;font-weight:600;}
tbody td{padding:8px 10px;border-bottom:1px solid #182028;}
tbody tr:nth-child(even){background:rgba(255,255,255,.025);}
code{background:#151d26;padding:.1em .35em;border-radius:4px;}
.muted{color:#8b959e;font-size:.9rem;}
</style>
<body>
<h1>Retroverse Rank — inspection overview</h1>
<p class="muted">CSV source: <code>summary_by_year.csv</code> · Per-year ranks: <code>by_year/</code> · Narrative: <code>SUMMARY.md</code></p>
<p>Open CSVs locally for full columns (rank‑one ties, IDs). Sort table by clicking column headers.</p>
<table id="t"><thead><tr>
<th data-col="year">year</th>
<th data-col="chart_raw_rows_in_year">raw rows</th>
<th data-col="total_ranked_slots">ranked slots</th>
<th data-col="unique_albums">unique albums</th>
<th data-col="albums_with_activity_in_multiple_years">multi‑year albums</th>
<th data-col="albums_tied_lowest_peak_same_as_rank_one">rank‑one tie count</th>
</tr></thead><tbody>${htmlTableRows}</tbody></table>
<script>
(() => {
  const table=document.getElementById("t");
  const thead=table.querySelector("thead");
  let sortIdx=0, dir=1;
  function sortBy(colIdx){
    const tbody=table.querySelector("tbody");
    const rows=[...tbody.rows];
    const num=(s)=>{ const n=Number(s.replace(/,/g,'')); return Number.isFinite(n)?n:NaN; };
    rows.sort((a,b)=>{
      const xa=a.cells[colIdx]?.textContent??"";
      const xb=b.cells[colIdx]?.textContent??"";
      const na=num(xa); const nb=num(xb);
      const cmp=!Number.isNaN(na)&&!Number.isNaN(nb)?na-nb:String(xa).localeCompare(String(xb));
      return cmp*dir;
    });
    for(const r of rows) tbody.appendChild(r);
  }
  thead.addEventListener("click",(e)=>{
    const th=e.target.closest("th"); if(!th) return;
    const col=[...thead.querySelectorAll("th")].indexOf(th); if(col<0) return;
    if(sortIdx===col) dir=-dir; else { sortIdx=col; dir=1; }
    sortBy(col);
  });
})();
</script>
</body>
</html>`;

  await writeFile(path.join(OUT_DIR, "index.html"), html, "utf8");

  const ruler = "=".repeat(72);
  process.stderr.write(`\n${ruler}\nRetroverse Rank — inventory (stderr)\n${ruler}\n`);
  process.stderr.write(
    `Chart years represented: ${years.length}  |  Distinct albums with any chart year: ${albumYears.size}\n`,
  );
  process.stderr.write(`Sum of per-year ranked albums (reuse across years counted each year): ${totalAppearanceSlotsAcrossYears}\n`);
  process.stderr.write(
    `Top 10 biggest years: ${byRankedDesc.slice(0, 10).map((r) => `${r.year}=${r.total_ranked_album_appearances}`).join(", ")}\n`,
  );
  process.stderr.write(
    `Top 10 smallest years: ${byRankedAsc.slice(0, 10).map((r) => `${r.year}=${r.total_ranked_album_appearances}`).join(", ")}\n`,
  );
  process.stderr.write(`${ruler}\n`);
  process.stderr.write(`[rank-inspection] Wrote outputs under ${path.relative(WORKSPACE, OUT_DIR)}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
