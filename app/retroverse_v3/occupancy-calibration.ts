import { retroverseAlbumChartAppearances } from "@/lib/billboard-album-chart-appearance";
import { createClient } from "@/lib/supabase";

import { chartDateToYearFloat } from "./occupancy-chart-math";
import { fetchBillboard200AppearancesForAlbum, MAX_PAGES_PER_ALBUM } from "./occupancy-queries";
import {
  DEFAULT_OBSERVATION_CENTER_YEAR,
} from "./occupancy-scope";
import { DEFAULT_OBSERVATION_SPAN_YEARS, renderZoomFromSpan } from "./temporal-window";
import type { Trail } from "./types";

const CAL_DEFAULT_RENDER_ZOOM = renderZoomFromSpan(DEFAULT_OBSERVATION_SPAN_YEARS);

export type CalibrationSpec = {
  key: string;
  /** Primary `ilike` needle on `canonical_album_title` */
  titleNeedle: string;
  /** Artist name must include this (case-insensitive), after exclusions */
  artistIncludes: string;
  excludeArtistSubstrings?: string[];
};

export const OCCUPANCY_CALIBRATION_ALBUMS: CalibrationSpec[] = [
  { key: "rumours", titleNeedle: "Rumours", artistIncludes: "fleetwood" },
  { key: "thriller", titleNeedle: "Thriller", artistIncludes: "jackson" },
  { key: "dark_side", titleNeedle: "Dark Side of the Moon", artistIncludes: "floyd" },
  { key: "hotel_california", titleNeedle: "Hotel California", artistIncludes: "eagles" },
  { key: "boston", titleNeedle: "Boston", artistIncludes: "boston", excludeArtistSubstrings: ["symphony", "pops"] },
  { key: "back_in_black", titleNeedle: "Back in Black", artistIncludes: "ac/dc" },
  { key: "nevermind", titleNeedle: "Nevermind", artistIncludes: "nirvana" },
  { key: "purple_rain", titleNeedle: "Purple Rain", artistIncludes: "prince" },
  { key: "abbey_road", titleNeedle: "Abbey Road", artistIncludes: "beatles" },
  { key: "zeppelin_iv", titleNeedle: "Led Zeppelin IV", artistIncludes: "zeppelin" },
];

type AlbumPick = {
  retroverse_album_id: string;
  canonical_album_title: string | null;
  retroverse_artist_id: string | null;
};

function artistOk(
  name: string,
  spec: CalibrationSpec,
): boolean {
  const n = name.toLowerCase();
  const inc = spec.artistIncludes.toLowerCase();
  if (!n.includes(inc)) return false;
  for (const ex of spec.excludeArtistSubstrings ?? []) {
    if (n.includes(ex.toLowerCase())) return false;
  }
  return true;
}

function pickAlbum(candidates: AlbumPick[], artists: Map<string, string>, spec: CalibrationSpec): AlbumPick | null {
  const withArtist = candidates.filter((c) => {
    const an = c.retroverse_artist_id ? artists.get(c.retroverse_artist_id) ?? "" : "";
    return artistOk(an, spec);
  });
  const pool = withArtist.length > 0 ? withArtist : [];
  if (pool.length === 0) return null;
  const needle = spec.titleNeedle.toLowerCase();
  const exact = pool.find((p) => (p.canonical_album_title ?? "").toLowerCase().trim() === needle);
  return exact ?? pool[0] ?? null;
}

export type CalibrationAlbumRow = {
  key: string;
  titleNeedle: string;
  matchedAlbumId: string | null;
  matchedTitle: string | null;
  matchedArtist: string | null;
  /** Raw rows returned from chart_appearances (Billboard 200 filter in SQL only). */
  dbRowCount: number;
  /** Rows whose `chart_name` passes `retroverseAlbumChartAppearances`. */
  rowsAfterChartNameFilter: number;
  uniqueChartDates: number;
  duplicateDateRows: number;
  firstChartDate: string | null;
  lastChartDate: string | null;
  chartSpanYears: number | null;
  /** Points that would enter `trailsFromRows` (valid position + year). */
  occupancyPointsSimulated: number;
  /** Renderer: no downsampling; all points in observation window are drawn. */
  rendererThinning: "none";
  inMainTrails: boolean;
  mainTrailPointCount: number | null;
  mainTrailSource: "canonical" | "synthetic" | null;
  defaultObservation: {
    centerYear: number;
    zoomLevel: number;
    visibleSpanYears: number;
    /** Horizontal squeeze: larger = trail calendar span is wider than one default window. */
    trailSpanToWindowRatio: number | null;
    /** Among points inside the default window, normalized X in 0–100 (signal viewBox). */
    xNormInWindow: { min: number; max: number } | null;
    /** Among those points, depthToY domain is 0–100 (piecewise Billboard buckets). */
    yNormInWindow: { min: number; max: number } | null;
  };
  /** True if pagination may have truncated (hit page cap with full last page). */
  loadMayBeTruncated: boolean;
};

function depthToY(position: number): number {
  const depthRanges = [
    { min: 1, max: 10 },
    { min: 11, max: 25 },
    { min: 26, max: 50 },
    { min: 51, max: 100 },
    { min: 101, max: 200 },
    { min: 201, max: 280 },
  ];
  for (let i = 0; i < depthRanges.length; i++) {
    const range = depthRanges[i]!;
    if (position >= range.min && position <= range.max) {
      const within = (position - range.min) / Math.max(1, range.max - range.min);
      return ((i + within) / depthRanges.length) * 100;
    }
  }
  return 99;
}

function analyzeRows(
  rows: import("./occupancy-queries").ChartAppearanceRow[],
  loadMayBeTruncated: boolean,
): Omit<
  CalibrationAlbumRow,
  | "key"
  | "titleNeedle"
  | "matchedAlbumId"
  | "matchedTitle"
  | "matchedArtist"
  | "inMainTrails"
  | "mainTrailPointCount"
  | "mainTrailSource"
> {
  let rowsAfter = 0;
  const yearFloats: number[] = [];
  const yNorms: number[] = [];
  const dates: string[] = [];
  const dateSet = new Set<string>();

  for (const row of rows) {
    if (!row.chart_name || !retroverseAlbumChartAppearances(row.chart_name)) continue;
    if (!Number.isFinite(row.chart_position) || row.chart_position == null) continue;
    const yf = chartDateToYearFloat(row.chart_date);
    if (yf === null) continue;
    rowsAfter++;
    yearFloats.push(yf);
    yNorms.push(depthToY(row.chart_position));
    if (row.chart_date) {
      const d = row.chart_date.slice(0, 10);
      dates.push(row.chart_date);
      dateSet.add(d);
    }
  }

  const sortedY = [...yearFloats].sort((a, b) => a - b);
  const spanYears =
    sortedY.length >= 2 ? sortedY[sortedY.length - 1]! - sortedY[0]! : sortedY.length === 1 ? 0 : null;

  const dateSorted = [...dates].sort();
  const firstChartDate = dateSorted[0] ?? null;
  const lastChartDate = dateSorted[dateSorted.length - 1] ?? null;

  const duplicateDateRows = Math.max(0, rowsAfter - dateSet.size);

  const visibleSpan = DEFAULT_OBSERVATION_SPAN_YEARS;
  const half = visibleSpan / 2;
  const vs = DEFAULT_OBSERVATION_CENTER_YEAR - half;
  const ve = DEFAULT_OBSERVATION_CENTER_YEAR + half;
  const xIn: number[] = [];
  const yIn: number[] = [];
  for (let i = 0; i < yearFloats.length; i++) {
    const xf = yearFloats[i]!;
    if (xf < vs || xf > ve) continue;
    xIn.push(((xf - vs) / visibleSpan) * 100);
    yIn.push(yNorms[i]!);
  }
  const xNormInWindow =
    xIn.length > 0
      ? { min: Math.min(...xIn), max: Math.max(...xIn) }
      : null;
  const yNormInWindow =
    yIn.length > 0
      ? { min: Math.min(...yIn), max: Math.max(...yIn) }
      : null;

  const trailSpanToWindowRatio =
    spanYears !== null && spanYears > 1e-6 ? spanYears / visibleSpan : spanYears === 0 ? 0 : null;

  return {
    dbRowCount: rows.length,
    rowsAfterChartNameFilter: rowsAfter,
    uniqueChartDates: dateSet.size,
    duplicateDateRows,
    firstChartDate,
    lastChartDate,
    chartSpanYears: spanYears,
    occupancyPointsSimulated: rowsAfter,
    rendererThinning: "none",
    loadMayBeTruncated,
    defaultObservation: {
      centerYear: DEFAULT_OBSERVATION_CENTER_YEAR,
      zoomLevel: CAL_DEFAULT_RENDER_ZOOM,
      visibleSpanYears: visibleSpan,
      trailSpanToWindowRatio,
      xNormInWindow,
      yNormInWindow,
    },
  };
}

export type OccupancyCalibrationReport = {
  mainDeckLoadPath: "canonical" | "fallback";
  note: string;
  albums: CalibrationAlbumRow[];
};

export async function gatherOccupancyCalibrationReport(
  supabase: ReturnType<typeof createClient> | null,
  trails: Trail[],
  mainDeckLoadPath: "canonical" | "fallback",
): Promise<OccupancyCalibrationReport> {
  const trailsById = new Map(trails.map((t) => [t.id.toUpperCase(), t]));
  const trailsByIdRaw = new Map(trails.map((t) => [t.id, t]));

  if (!supabase) {
    return {
      mainDeckLoadPath,
      note: "Supabase unavailable — calibration DB probes skipped.",
      albums: OCCUPANCY_CALIBRATION_ALBUMS.map((spec) => ({
        key: spec.key,
        titleNeedle: spec.titleNeedle,
        matchedAlbumId: null,
        matchedTitle: null,
        matchedArtist: null,
        dbRowCount: 0,
        rowsAfterChartNameFilter: 0,
        uniqueChartDates: 0,
        duplicateDateRows: 0,
        firstChartDate: null,
        lastChartDate: null,
        chartSpanYears: null,
        occupancyPointsSimulated: 0,
        rendererThinning: "none",
        inMainTrails: false,
        mainTrailPointCount: null,
        mainTrailSource: null,
        defaultObservation: {
          centerYear: DEFAULT_OBSERVATION_CENTER_YEAR,
          zoomLevel: CAL_DEFAULT_RENDER_ZOOM,
          visibleSpanYears: DEFAULT_OBSERVATION_SPAN_YEARS,
          trailSpanToWindowRatio: null,
          xNormInWindow: null,
          yNormInWindow: null,
        },
        loadMayBeTruncated: false,
      })),
    };
  }

  const albums: CalibrationAlbumRow[] = [];

  for (const spec of OCCUPANCY_CALIBRATION_ALBUMS) {
    const { data: rawAlbums, error: aErr } = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
      .ilike("canonical_album_title", `%${spec.titleNeedle}%`)
      .limit(24);

    if (aErr || !rawAlbums?.length) {
      albums.push({
        key: spec.key,
        titleNeedle: spec.titleNeedle,
        matchedAlbumId: null,
        matchedTitle: null,
        matchedArtist: null,
        dbRowCount: 0,
        rowsAfterChartNameFilter: 0,
        uniqueChartDates: 0,
        duplicateDateRows: 0,
        firstChartDate: null,
        lastChartDate: null,
        chartSpanYears: null,
        occupancyPointsSimulated: 0,
        rendererThinning: "none",
        inMainTrails: false,
        mainTrailPointCount: null,
        mainTrailSource: null,
        defaultObservation: {
          centerYear: DEFAULT_OBSERVATION_CENTER_YEAR,
          zoomLevel: CAL_DEFAULT_RENDER_ZOOM,
          visibleSpanYears: DEFAULT_OBSERVATION_SPAN_YEARS,
          trailSpanToWindowRatio: null,
          xNormInWindow: null,
          yNormInWindow: null,
        },
        loadMayBeTruncated: false,
      });
      continue;
    }

    const artistIds = [
      ...new Set(
        (rawAlbums as AlbumPick[]).map((a) => a.retroverse_artist_id).filter((id): id is string => Boolean(id)),
      ),
    ];
    const artistMap = new Map<string, string>();
    for (let i = 0; i < artistIds.length; i += 80) {
      const chunk = artistIds.slice(i, i + 80);
      const { data: arts } = await supabase
        .from("retroverse_artists")
        .select("retroverse_artist_id, canonical_artist_name")
        .in("retroverse_artist_id", chunk);
      for (const row of arts ?? []) {
        const r = row as { retroverse_artist_id: string; canonical_artist_name: string | null };
        artistMap.set(
          r.retroverse_artist_id,
          (r.canonical_artist_name ?? "").trim() || "Unknown artist",
        );
      }
    }

    const picked = pickAlbum(rawAlbums as AlbumPick[], artistMap, spec);
    if (!picked) {
      albums.push({
        key: spec.key,
        titleNeedle: spec.titleNeedle,
        matchedAlbumId: null,
        matchedTitle: null,
        matchedArtist: null,
        dbRowCount: 0,
        rowsAfterChartNameFilter: 0,
        uniqueChartDates: 0,
        duplicateDateRows: 0,
        firstChartDate: null,
        lastChartDate: null,
        chartSpanYears: null,
        occupancyPointsSimulated: 0,
        rendererThinning: "none",
        inMainTrails: false,
        mainTrailPointCount: null,
        mainTrailSource: null,
        defaultObservation: {
          centerYear: DEFAULT_OBSERVATION_CENTER_YEAR,
          zoomLevel: CAL_DEFAULT_RENDER_ZOOM,
          visibleSpanYears: DEFAULT_OBSERVATION_SPAN_YEARS,
          trailSpanToWindowRatio: null,
          xNormInWindow: null,
          yNormInWindow: null,
        },
        loadMayBeTruncated: false,
      });
      continue;
    }

    const artistName = picked.retroverse_artist_id
      ? artistMap.get(picked.retroverse_artist_id) ?? "Unknown artist"
      : "Unknown artist";

    const rows = await fetchBillboard200AppearancesForAlbum(supabase, picked.retroverse_album_id);
    const loadMayBeTruncated = rows.length >= MAX_PAGES_PER_ALBUM * 1000;

    const core = analyzeRows(rows, loadMayBeTruncated);
    const main =
      trailsById.get(picked.retroverse_album_id.toUpperCase()) ??
      trailsByIdRaw.get(picked.retroverse_album_id);

    albums.push({
      key: spec.key,
      titleNeedle: spec.titleNeedle,
      matchedAlbumId: picked.retroverse_album_id,
      matchedTitle: picked.canonical_album_title,
      matchedArtist: artistName,
      ...core,
      inMainTrails: Boolean(main),
      mainTrailPointCount: main ? main.points.length : null,
      mainTrailSource: main ? main.source : null,
    });
  }

  return {
    mainDeckLoadPath,
    note:
      "Main-deck trails use `canonical_album_chart_runs` (one row per album × chart week, Billboard 200 only). Appearances are loaded with one paginated query per album (up to 48k rows each). Renderer draws every in-window point (no thinning). Y uses fixed Billboard depth bands.",
    albums,
  };
}
