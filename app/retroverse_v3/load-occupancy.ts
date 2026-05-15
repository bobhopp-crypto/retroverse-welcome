import { unstable_cache } from "next/cache";

import { createClient } from "@/lib/supabase";

import { gatherOccupancyCalibrationReport } from "./occupancy-calibration";
import { chartDateToYearFloat, chartRankFromRaw } from "./occupancy-chart-math";
import { fetchBillboard200AppearancesForAlbum, type ChartAppearanceRow } from "./occupancy-queries";
import { fallbackTrails } from "./fallback-trails";
import type { ChartPoint, Trail, TrailCover } from "./types";

const TRAIL_LIMIT = 24;
const MIN_TRAIL_POINTS = 12;
const HEAVY_HITTER_WEEKS = 60;
/** When `weeks_on_chart` is null site-wide, rank albums by row counts in this many rows per scan direction (asc + desc). */
const HEAVY_HITTER_DENSITY_PAGES = 40;
const FETCH_CONCURRENCY = 5;

const PALETTE = [
  "#f1a046",
  "#f4b449",
  "#f4c25e",
  "#f5b66a",
  "#f6c25c",
  "#f5a14e",
  "#f6d057",
  "#f1a04a",
  "#f8d05a",
  "#f0a14a",
  "#f4a45a",
  "#f29b48",
  "#f3a54a",
  "#f4b95a",
  "#f5be63",
  "#f4b758",
  "#f4c45a",
  "#f4cf6a",
  "#f3a44a",
  "#f4c95d",
];

const COVERS: TrailCover[] = [
  { sky: "#284d63", ground: "#a73e2a", sun: "#f6c956" },
  { sky: "#27424f", ground: "#a2602f", sun: "#efc265" },
  { sky: "#3a2733", ground: "#b66236", sun: "#f0c558" },
  { sky: "#1a1a23", ground: "#2a1d10", sun: "#f1c25a" },
  { sky: "#2a3a4e", ground: "#a5512c", sun: "#f3c66a" },
  { sky: "#23303e", ground: "#a9502a", sun: "#f0bb55" },
  { sky: "#1d1d2a", ground: "#8a3220", sun: "#f3c45a" },
  { sky: "#1d2742", ground: "#a23a26", sun: "#f1c660" },
  { sky: "#1c2a3b", ground: "#b35a30", sun: "#f3c357" },
  { sky: "#13354c", ground: "#6c4a25", sun: "#e9b350" },
  { sky: "#26323d", ground: "#a8682d", sun: "#f1c45e" },
  { sky: "#1c1818", ground: "#6f2b27", sun: "#e6a14d" },
];

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h * 31 + value.charCodeAt(i)) >>> 0;
  }
  return h;
}

function colorFor(id: string): string {
  return PALETTE[hash(id) % PALETTE.length];
}

function coverFor(id: string): TrailCover {
  return COVERS[hash(`${id}-cover`) % COVERS.length];
}

type RawAppearance = ChartAppearanceRow;

type AlbumLookup = Map<
  string,
  { title: string; artistId: string | null }
>;

type ArtistLookup = Map<string, string>;

async function fetchHeavyHitterIds(
  supabase: ReturnType<typeof createClient>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("canonical_album_chart_week_counts")
    .select("retroverse_album_id, chart_weeks")
    .gt("chart_weeks", HEAVY_HITTER_WEEKS)
    .order("chart_weeks", { ascending: false })
    .limit(800);

  if (error || !data) return [];

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const row of data as Array<{ retroverse_album_id: string | null; chart_weeks?: number }>) {
    if (!row.retroverse_album_id) continue;
    const id = row.retroverse_album_id.toUpperCase();
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= TRAIL_LIMIT * 2) break;
  }
  return ids;
}

/**
 * When `weeks_on_chart` is never populated, the weeks-based heavy list is empty.
 * Approximate “heavy” albums by counting Billboard-200-filtered rows in the earliest
 * and latest chart slices (bounded scan, cached 1h). Head-only scans miss albums whose
 * mass of rows sits in the middle / recent decades.
 */
async function fetchHeavyHitterIdsByDensityScan(
  supabase: ReturnType<typeof createClient>,
): Promise<string[]> {
  const PAGE = 1000;
  const counts = new Map<string, number>();

  const tally = (data: Array<{ retroverse_album_id: string | null }> | null) => {
    if (!data) return;
    for (const row of data) {
      if (!row.retroverse_album_id) continue;
      const id = row.retroverse_album_id.toUpperCase();
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  };

  for (let page = 0; page < HEAVY_HITTER_DENSITY_PAGES; page++) {
    const { data, error } = await supabase
      .from("canonical_album_chart_runs")
      .select("retroverse_album_id, chart_date")
      .not("retroverse_album_id", "is", null)
      .order("chart_date", { ascending: true })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error || !data || data.length === 0) break;
    tally(data);
    if (data.length < PAGE) break;
  }

  for (let page = 0; page < HEAVY_HITTER_DENSITY_PAGES; page++) {
    const { data, error } = await supabase
      .from("canonical_album_chart_runs")
      .select("retroverse_album_id, chart_date")
      .not("retroverse_album_id", "is", null)
      .order("chart_date", { ascending: false })
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (error || !data || data.length === 0) break;
    tally(data);
    if (data.length < PAGE) break;
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TRAIL_LIMIT * 2)
    .map(([id]) => id);
}

/**
 * One paginated query per album so chronology is not “stolen” by co-chunk peers
 * (previous bug: shared ORDER BY chart_date + row cap truncated late‑career albums).
 */
async function fetchAppearancesForAlbums(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<RawAppearance[]> {
  const all: RawAppearance[] = [];
  for (let i = 0; i < ids.length; i += FETCH_CONCURRENCY) {
    const slice = ids.slice(i, i + FETCH_CONCURRENCY);
    const parts = await Promise.all(
      slice.map((id) => fetchBillboard200AppearancesForAlbum(supabase, id)),
    );
    for (const rows of parts) all.push(...rows);
  }
  return all;
}

async function fetchAlbumLookup(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<AlbumLookup> {
  const lookup: AlbumLookup = new Map();
  if (ids.length === 0) return lookup;
  for (let i = 0; i < ids.length; i += 120) {
    const chunk = ids.slice(i, i + 120);
    const { data, error } = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
      .in("retroverse_album_id", chunk);
    if (error || !data) continue;
    for (const row of data as Array<{
      retroverse_album_id: string;
      canonical_album_title: string | null;
      retroverse_artist_id: string | null;
    }>) {
      lookup.set(row.retroverse_album_id.toUpperCase(), {
        title: (row.canonical_album_title ?? "Unknown album").trim() || "Unknown album",
        artistId: row.retroverse_artist_id ?? null,
      });
    }
  }
  return lookup;
}

async function fetchArtistLookup(
  supabase: ReturnType<typeof createClient>,
  artistIds: string[],
): Promise<ArtistLookup> {
  const lookup: ArtistLookup = new Map();
  if (artistIds.length === 0) return lookup;
  for (let i = 0; i < artistIds.length; i += 120) {
    const chunk = artistIds.slice(i, i + 120);
    const { data, error } = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .in("retroverse_artist_id", chunk);
    if (error || !data) continue;
    for (const row of data as Array<{
      retroverse_artist_id: string;
      canonical_artist_name: string | null;
    }>) {
      lookup.set(
        row.retroverse_artist_id,
        (row.canonical_artist_name ?? "Unknown artist").trim() || "Unknown artist",
      );
    }
  }
  return lookup;
}

function trailsFromRows(
  rows: RawAppearance[],
  albums: AlbumLookup,
  artists: ArtistLookup,
): Trail[] {
  const grouped = new Map<string, Map<string, ChartPoint>>();
  for (const row of rows) {
    if (!row.retroverse_album_id) continue;
    if (!row.chart_name || row.chart_name.trim() !== "Billboard 200") continue;
    const rank = chartRankFromRaw(row.chart_position);
    if (rank === null) continue;
    const yearFloat = chartDateToYearFloat(row.chart_date);
    if (yearFloat === null) continue;
    const dateKey = row.chart_date ? String(row.chart_date).slice(0, 10) : "";
    if (dateKey.length < 8) continue;
    const id = row.retroverse_album_id.toUpperCase();
    if (!grouped.has(id)) grouped.set(id, new Map());
    grouped.get(id)!.set(dateKey, { yearFloat, position: rank });
  }

  const trails: Trail[] = [];
  for (const [id, byDate] of grouped.entries()) {
    const points = [...byDate.values()].sort((a, b) => a.yearFloat - b.yearFloat);
    if (points.length < MIN_TRAIL_POINTS) continue;
    const album = albums.get(id);
    if (!album) continue;
    const artistName = album.artistId ? artists.get(album.artistId) ?? "Unknown artist" : "Unknown artist";
    const releaseYear = Math.floor(points[0]!.yearFloat);
    trails.push({
      id,
      title: album.title,
      artist: artistName,
      color: colorFor(id),
      cover: coverFor(id),
      points,
      archiveHref: `/search?q=${encodeURIComponent(album.title)}`,
      artistHref: `/search?q=${encodeURIComponent(artistName)}`,
      releaseYear,
      source: "canonical",
    });
  }

  trails.sort((a, b) => b.points.length - a.points.length);
  return trails.slice(0, TRAIL_LIMIT);
}

export type OccupancyLoadReport = {
  path: "canonical" | "fallback";
  reason:
    | "ok"
    | "missing_env"
    | "no_heavy_hitters"
    | "no_appearance_rows"
    | "trails_sparse_lt5"
    | "exception";
  /** How the candidate album id list was built (only when Supabase path ran). */
  heavyHitterStrategy?: "weeks_gt_60" | "appearance_density_scan";
  heavyHitterCandidateCount: number;
  appearanceRowsFetched: number;
  trailsReturned: number;
};

export type OccupancyBundle = {
  trails: Trail[];
  loadReport: OccupancyLoadReport;
  calibration: Awaited<ReturnType<typeof gatherOccupancyCalibrationReport>> | null;
};

async function loadOccupancyBundleUncached(calibration: boolean): Promise<OccupancyBundle> {
  const emptyReport = (partial: Partial<OccupancyLoadReport>): OccupancyLoadReport => ({
    path: "fallback",
    reason: "missing_env",
    heavyHitterCandidateCount: 0,
    appearanceRowsFetched: 0,
    trailsReturned: 0,
    ...partial,
  });

  const withCalibration = async (
    trails: Trail[],
    path: "canonical" | "fallback",
    report: OccupancyLoadReport,
    supabase: ReturnType<typeof createClient> | null,
  ): Promise<OccupancyBundle> => ({
    trails,
    loadReport: report,
    calibration: calibration ? await gatherOccupancyCalibrationReport(supabase, trails, path) : null,
  });

  try {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
      const trails = fallbackTrails;
      return withCalibration(trails, "fallback", emptyReport({ reason: "missing_env", trailsReturned: trails.length }), null);
    }
    const supabase = createClient();
    let heavyIds = await fetchHeavyHitterIds(supabase);
    let heavyHitterStrategy: NonNullable<OccupancyLoadReport["heavyHitterStrategy"]> = "weeks_gt_60";
    if (heavyIds.length === 0) {
      heavyIds = await fetchHeavyHitterIdsByDensityScan(supabase);
      heavyHitterStrategy = "appearance_density_scan";
    }
    if (heavyIds.length === 0) {
      const trails = fallbackTrails;
      return withCalibration(
        trails,
        "fallback",
        emptyReport({ reason: "no_heavy_hitters", trailsReturned: trails.length }),
        supabase,
      );
    }
    const rows = await fetchAppearancesForAlbums(supabase, heavyIds);
    if (rows.length === 0) {
      const trails = fallbackTrails;
      return withCalibration(
        trails,
        "fallback",
        emptyReport({
          reason: "no_appearance_rows",
          heavyHitterCandidateCount: heavyIds.length,
          heavyHitterStrategy,
          trailsReturned: trails.length,
        }),
        supabase,
      );
    }
    const albums = await fetchAlbumLookup(supabase, heavyIds);
    const artistIds = Array.from(
      new Set(
        Array.from(albums.values())
          .map((a) => a.artistId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const artists = await fetchArtistLookup(supabase, artistIds);
    const trails = trailsFromRows(rows, albums, artists);
    return withCalibration(
      trails,
      "canonical",
      {
        path: "canonical",
        reason: trails.length === 0 ? "trails_sparse_lt5" : "ok",
        heavyHitterStrategy,
        heavyHitterCandidateCount: heavyIds.length,
        appearanceRowsFetched: rows.length,
        trailsReturned: trails.length,
      },
      supabase,
    );
  } catch {
    const trails = fallbackTrails;
    return withCalibration(
      trails,
      "fallback",
      {
        path: "fallback",
        reason: "exception",
        heavyHitterCandidateCount: 0,
        appearanceRowsFetched: 0,
        trailsReturned: trails.length,
      },
      null,
    );
  }
}

/**
 * Uncached bundle load for CLI/scripts. `unstable_cache` is unavailable outside a Next request.
 * The `/retroverse_v3` page uses `loadOccupancyBundle` (cached).
 */
export async function loadOccupancyBundleDirect(calibration: boolean): Promise<OccupancyBundle> {
  return loadOccupancyBundleUncached(calibration);
}

const loadBundleNoCal = unstable_cache(
  () => loadOccupancyBundleUncached(false),
  ["retroverse-v3-occupancy-bundle-v6-canonical-spine"],
  { revalidate: 3600, tags: ["retroverse-v3-occupancy"] },
);

const loadBundleWithCal = unstable_cache(
  () => loadOccupancyBundleUncached(true),
  ["retroverse-v3-occupancy-bundle-cal-v6-canonical-spine"],
  { revalidate: 3600, tags: ["retroverse-v3-occupancy"] },
);

export async function loadOccupancyBundle(calibration: boolean): Promise<OccupancyBundle> {
  return calibration ? loadBundleWithCal() : loadBundleNoCal();
}

/** @deprecated Prefer `loadOccupancyBundle(false)` — kept for single-callers. */
export async function loadOccupancyTrails(): Promise<Trail[]> {
  const b = await loadBundleNoCal();
  return b.trails;
}
