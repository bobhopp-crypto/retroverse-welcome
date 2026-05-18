import { unstable_cache } from "next/cache";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { retroverseAlbumChartAppearances } from "@/lib/billboard-album-chart-appearance";
import { albumIdFromChartAppearanceRow } from "@/lib/chart-appearance-album-id";
import { comparePortalYearAlbumRank } from "@/lib/portal-year-rank-sort";
import { CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG } from "@/lib/canonical-artwork-overrides";
import { hydrateDiscoverAlbumRows } from "@/lib/discover-hydrate-rows";
import {
  hydrateSqliteAlbumRows,
  isSqliteCorpusAlbumId,
  loadSqliteCorpusCounts,
  loadSqliteCorpusYears,
  loadSqliteRankedAlbumEntriesForYear,
} from "@/lib/viewer-corpus-sqlite";
import { createClient } from "@/lib/supabase";

const YEAR_PAGE = 1000;
/** Prefer this year when bootstrapping /portal if the corpus has rows for it. */
export const VIEWER_BOOTSTRAP_DEFAULT_YEAR = 1976;

/** One row per album in a calendar year: ordered for portal vertical navigation. */
export type ViewerYearAlbumEntry = {
  albumId: string;
  /** 1-based ordinal in this year's list (portal display). */
  displayRank: number;
  /** Best (lowest) weekly chart position observed for this album in this year, or null when using release-year fallback ordering. */
  peakChartPosition: number | null;
  /** Max `weeks_on_chart` seen for any chart row in this year for this album (optional signal). */
  weeksOnChart: number | null;
};

export type ViewerBootstrap = {
  years: number[];
  year: number;
  /** Rank-ordered album appearances for the active bootstrap year. */
  entries: ViewerYearAlbumEntry[];
  /** Same order as `entries` (compatibility for legacy portal routes). */
  albumIds: string[];
  startIndex: number;
  hydrated: DiscoverStableAlbumRow[];
  /** True when one or more bootstrap sections failed (e.g. Supabase offline). */
  sourceOffline?: boolean;
  /** Runtime corpus provider used for years / year-album navigation. */
  corpusSource?: "supabase" | "sqlite";
};

function bootstrapErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.message === "string") return o.message;
    if (typeof o.error === "string") return o.error;
    if (typeof o.details === "string") return o.details;
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/** Operational backend outage — degrade quietly, do not console.error. */
export function isExpectedBootstrapFailure(err: unknown): boolean {
  const msg = bootstrapErrorMessage(err).toLowerCase();
  const parts: string[] = [msg];

  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    if (typeof o.code === "string") parts.push(o.code.toLowerCase());
    if (typeof o.name === "string") parts.push(o.name.toLowerCase());
    if (typeof o.cause === "string") parts.push(o.cause.toLowerCase());
    else if (o.cause) parts.push(bootstrapErrorMessage(o.cause).toLowerCase());
  }

  const haystack = parts.join(" ");
  const expected = [
    "schema cache",
    "retry",
    "fetch failed",
    "failed to fetch",
    "network timeout",
    "network error",
    "timed out",
    "timeout",
    "econnrefused",
    "enotfound",
    "econnreset",
    "terminated",
    "connection terminated",
    "postgrest unavailable",
    "postgrest",
    "503",
    "502",
    "504",
    "service unavailable",
    "socket hang up",
    "getaddrinfo",
    "aborterror",
    "dns",
    "unreachable",
  ];

  return expected.some((needle) => haystack.includes(needle));
}

function logBootstrapFailure(
  section: "years" | "entries" | "hydrated" | "cache_wrapper",
  err: unknown,
): void {
  const message = bootstrapErrorMessage(err);
  if (isExpectedBootstrapFailure(err)) {
    console.warn(`[portal/bootstrap] ${section}_offline error=${message}`);
  } else {
    console.error(`[portal/bootstrap] ${section}_unexpected error=${message}`);
  }
}

/** Degraded bootstrap — portal shell still renders; prefers SQLite corpus when available. */
export function emptyViewerBootstrap(overrides?: Partial<ViewerBootstrap>): ViewerBootstrap {
  let years: number[] = [];
  let entries: ViewerYearAlbumEntry[] = [];
  let corpusSource: "supabase" | "sqlite" = "supabase";
  try {
    years = loadSqliteCorpusYears();
    if (years.length > 0) {
      corpusSource = "sqlite";
      const year = years.includes(VIEWER_BOOTSTRAP_DEFAULT_YEAR)
        ? VIEWER_BOOTSTRAP_DEFAULT_YEAR
        : years[0]!;
      entries = loadSqliteRankedAlbumEntriesForYear(year);
      const windowIds = entries.slice(0, 5).map((e) => e.albumId);
      return {
        years,
        year,
        entries,
        albumIds: entries.map((e) => e.albumId),
        startIndex: 0,
        hydrated: hydrateSqliteAlbumRows(windowIds, year),
        sourceOffline: true,
        corpusSource,
        ...overrides,
      };
    }
  } catch {
    /* fall through */
  }

  return {
    years: [],
    year: VIEWER_BOOTSTRAP_DEFAULT_YEAR,
    entries: [],
    albumIds: [],
    startIndex: 0,
    hydrated: [],
    sourceOffline: true,
    corpusSource,
    ...overrides,
  };
}

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

function chunkIds<T>(xs: T[], n: number): T[][] {
  if (xs.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function loadAlbumSortLabels(
  supabase: ReturnType<typeof createClient>,
  albumIds: string[],
): Promise<Map<string, { artist: string; album: string }>> {
  const out = new Map<string, { artist: string; album: string }>();
  const uniq = [...new Set(albumIds.map((id) => id.trim().toUpperCase()).filter(Boolean))];
  for (const idChunk of chunkIds(uniq, 120)) {
    const part = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
      .in("retroverse_album_id", idChunk);
    if (part.error) throw part.error;
    const albums = (part.data ?? []) as Array<{
      retroverse_album_id: string;
      canonical_album_title: string | null;
      retroverse_artist_id: string;
    }>;
    const artistIds = [...new Set(albums.map((a) => a.retroverse_artist_id))];
    const artistName = new Map<string, string>();
    for (const arChunk of chunkIds(artistIds, 120)) {
      const ar = await supabase
        .from("retroverse_artists")
        .select("retroverse_artist_id, canonical_artist_name")
        .in("retroverse_artist_id", arChunk);
      if (ar.error) throw ar.error;
      for (const row of (ar.data ?? []) as Array<{
        retroverse_artist_id: string;
        canonical_artist_name: string | null;
      }>) {
        artistName.set(
          row.retroverse_artist_id,
          String(row.canonical_artist_name ?? "").trim() || "?",
        );
      }
    }
    for (const al of albums) {
      const aid = al.retroverse_album_id.trim().toUpperCase();
      const title = String(al.canonical_album_title ?? "").trim() || "?";
      out.set(aid, {
        album: title,
        artist: artistName.get(al.retroverse_artist_id) ?? "?",
      });
    }
  }
  return out;
}

/**
 * Portal year/album lists: years represented in retroverse_albums (paginated lightweight scan).
 *
 * Cached aggressively — this is a multi-roundtrip scan of every album row and
 * is the single biggest contributor to homepage (`/`) cold-render time. Years
 * change only on data import (rare); 7-day TTL with manual revalidation via
 * `revalidateTag("viewer-distinct-years")` when an import runs.
 */
async function loadViewerDistinctYearsSupabaseImpl(): Promise<number[]> {
  const seen = new Set<number>();
  const supabase = createClient();
  for (let from = 0; ; from += YEAR_PAGE) {
    const part = await supabase
      .from("retroverse_albums")
      .select("release_year")
      .not("release_year", "is", null)
      .range(from, from + YEAR_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    if (rows.length === 0) break;
    for (const r of rows as { release_year: number | null }[]) {
      const y = r.release_year;
      if (typeof y === "number" && Number.isFinite(y)) seen.add(y);
    }
    if (rows.length < YEAR_PAGE) break;
  }
  return [...seen].sort((a, b) => b - a);
}

async function loadViewerDistinctYearsImpl(): Promise<number[]> {
  try {
    const years = await loadViewerDistinctYearsSupabaseImpl();
    if (years.length > 0) return years;
  } catch (err) {
    logBootstrapFailure("years", err);
  }

  const sqliteYears = loadSqliteCorpusYears();
  if (sqliteYears.length > 0) {
    const counts = loadSqliteCorpusCounts();
    console.warn(
      `[portal/bootstrap] years_sqlite_fallback count=${sqliteYears.length} bb200_rows=${counts.billboard200WeeklyRows} hot100_weeks=${counts.hot100Weeks}`,
    );
    return sqliteYears;
  }

  return [];
}

export async function loadViewerDistinctYears(): Promise<number[]> {
  return unstable_cache(
    loadViewerDistinctYearsImpl,
    ["viewer-distinct-years-v2"],
    { revalidate: 60 * 60 * 24 * 7, tags: ["viewer-distinct-years"] },
  )();
}

export async function loadViewerAlbumIdsForYear(year: number): Promise<string[]> {
  const supabase = createClient();
  const out: string[] = [];
  for (let from = 0; ; from += YEAR_PAGE) {
    const part = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id")
      .eq("release_year", year)
      .order("canonical_album_title", { ascending: true })
      .range(from, from + YEAR_PAGE - 1);
    if (part.error) throw part.error;
    const rows = (part.data ?? []) as Array<{ retroverse_album_id: string }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      const id = row.retroverse_album_id.trim();
      if (id) out.push(id.toUpperCase());
    }
    if (rows.length < YEAR_PAGE) break;
  }
  return out;
}

/**
 * Builds a year's album list from **US Billboard album chart** appearances in `retroverse_chart_appearances`
 * (**`retroverseAlbumChartAppearances(chart_name)`**), resolving `retroverse_album_id` from the chart row
 * (**direct album anchor**) or via **`retroverse_tracks`**: one aggregated slice per calendar year — **best position**, **max
 * Billboard `weeks_on_chart` field**, weekly **appearance row counts**, earliest chart date —
 * sorts with **`comparePortalYearAlbumRank`** (peak ASC → weeks DESC → density DESC → timing → titles).
 *
 * Fallback: alphabetical `release_year` albums when nothing charted on **Billboard album lists** that year.
 */
async function loadViewerRankedAlbumEntriesForYearSupabaseImpl(
  year: number,
): Promise<ViewerYearAlbumEntry[]> {
  const supabase = createClient();
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;
  const pageSize = 1000;
  const agg = new Map<string, { minPos: number; maxWeeks: number; rowCount: number; firstDate: string }>();

  for (let from = 0; ; from += pageSize) {
    const part = await supabase
      .from("retroverse_chart_appearances")
      .select(
        "chart_date, chart_name, chart_position, weeks_on_chart, retroverse_album_id, retroverse_tracks(retroverse_album_id)",
      )
      .gte("chart_date", fromDate)
      .lte("chart_date", toDate)
      .range(from, from + pageSize - 1);

    if (part.error) throw part.error;
    const rows = (part.data ?? []) as unknown as ChartAggRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      if (!retroverseAlbumChartAppearances(row.chart_name ?? "")) continue;
      const albumId = albumIdFromChartAppearanceRow(row);
      if (!albumId) continue;
      const id = albumId.toUpperCase();
      const pos = row.chart_position;
      if (typeof pos !== "number" || !Number.isFinite(pos) || pos <= 0) continue;
      const w = row.weeks_on_chart;
      const weeks = typeof w === "number" && Number.isFinite(w) && w >= 0 ? w : 0;
      const prev = agg.get(id);
      if (!prev) {
        agg.set(id, {
          minPos: pos,
          maxWeeks: weeks,
          rowCount: 1,
          firstDate: row.chart_date,
        });
      } else {
        prev.rowCount += 1;
        prev.minPos = Math.min(prev.minPos, pos);
        prev.maxWeeks = Math.max(prev.maxWeeks, weeks);
        if (row.chart_date < prev.firstDate) prev.firstDate = row.chart_date;
      }
    }

    if (rows.length < pageSize) break;
  }

  if (agg.size === 0) {
    const rawIds = await loadViewerAlbumIdsForYear(year);
    if (rawIds.length === 0) return [];
    const metaFb = await loadAlbumSortLabels(supabase, rawIds);
    const sorted = [...rawIds].sort((a, b) => {
      const ma = metaFb.get(a) ?? { artist: "", album: "" };
      const mb = metaFb.get(b) ?? { artist: "", album: "" };
      const c4 = ma.artist.localeCompare(mb.artist, "en", { sensitivity: "base" });
      if (c4 !== 0) return c4;
      const c5 = ma.album.localeCompare(mb.album, "en", { sensitivity: "base" });
      if (c5 !== 0) return c5;
      return a.localeCompare(b);
    });
    return sorted.map((albumId, i) => ({
      albumId,
      displayRank: i + 1,
      peakChartPosition: null,
      weeksOnChart: null,
    }));
  }

  const albumIds = [...agg.keys()];
  const meta = await loadAlbumSortLabels(supabase, albumIds);

  const sortKeys = albumIds.map((albumId) => {
    const v = agg.get(albumId)!;
    const m = meta.get(albumId) ?? { artist: "?", album: "?" };
    return {
      peakChartPosition: v.minPos,
      weeksOnChart: v.maxWeeks,
      weeklyChartRows: v.rowCount,
      firstChartDate: v.firstDate,
      artist: m.artist,
      album: m.album,
      albumId,
    };
  });
  sortKeys.sort(comparePortalYearAlbumRank);

  return sortKeys.map((r, i) => ({
    albumId: r.albumId,
    displayRank: i + 1,
    peakChartPosition: r.peakChartPosition,
    weeksOnChart: r.weeksOnChart > 0 ? r.weeksOnChart : null,
  }));
}

/**
 * Public year-albums loader.
 *
 * Wraps the underlying Supabase paginated chart-appearance scan with Next's
 * `unstable_cache`. The data is historical (1950s–present Billboard data) and
 * essentially immutable at portal render time, so the cache TTL is intentionally
 * long (7 days) and tagged per-year so it can be invalidated surgically if a
 * data import touches a specific year.
 *
 * Measured impact (dev box, Supabase free tier):
 *   - cold per year: ~4 s (unchanged — first visit still scans)
 *   - warm per year: <50 ms (was ~3.5 s — every visit re-scanned)
 *
 * The client already prefetches ±1 year on every navigation, so once the user
 * has touched a year band, all subsequent year switches in that band feel instant.
 */
async function loadViewerRankedAlbumEntriesForYearImpl(year: number): Promise<ViewerYearAlbumEntry[]> {
  try {
    const entries = await loadViewerRankedAlbumEntriesForYearSupabaseImpl(year);
    if (entries.length > 0) return entries;
  } catch (err) {
    logBootstrapFailure("entries", err);
  }

  const sqliteEntries = loadSqliteRankedAlbumEntriesForYear(year);
  if (sqliteEntries.length > 0) {
    console.warn(
      `[portal/bootstrap] entries_sqlite_fallback year=${year} count=${sqliteEntries.length}`,
    );
    return sqliteEntries;
  }

  return [];
}

export async function loadViewerRankedAlbumEntriesForYear(year: number): Promise<ViewerYearAlbumEntry[]> {
  return unstable_cache(
    async () => loadViewerRankedAlbumEntriesForYearImpl(year),
    ["viewer-year-albums-v2", String(year)],
    { revalidate: 60 * 60 * 24 * 7, tags: ["viewer-year-albums", `viewer-year-albums:${year}`] },
  )();
}

async function loadViewerBootstrapImpl(): Promise<ViewerBootstrap> {
  let sourceOffline = false;
  let corpusSource: "supabase" | "sqlite" = "supabase";

  let years: number[] = [];
  try {
    years = await loadViewerDistinctYearsSupabaseImpl();
  } catch (err) {
    logBootstrapFailure("years", err);
    years = [];
    sourceOffline = true;
  }
  if (years.length === 0) {
    const sqliteYears = loadSqliteCorpusYears();
    if (sqliteYears.length > 0) {
      years = sqliteYears;
      corpusSource = "sqlite";
      sourceOffline = true;
      const counts = loadSqliteCorpusCounts();
      console.warn(
        `[portal/bootstrap] years_sqlite_fallback count=${years.length} bb200_rows=${counts.billboard200WeeklyRows} hot100_weeks=${counts.hot100Weeks}`,
      );
    }
  }

  let chosenYear = years.includes(VIEWER_BOOTSTRAP_DEFAULT_YEAR)
    ? VIEWER_BOOTSTRAP_DEFAULT_YEAR
    : (years[0] ?? VIEWER_BOOTSTRAP_DEFAULT_YEAR);
  let entries: ViewerYearAlbumEntry[] = [];

  const loadEntriesForYear = async (y: number): Promise<ViewerYearAlbumEntry[]> => {
    if (corpusSource === "sqlite") {
      return loadSqliteRankedAlbumEntriesForYear(y);
    }
    try {
      const fromSupabase = await loadViewerRankedAlbumEntriesForYearSupabaseImpl(y);
      if (fromSupabase.length > 0) return fromSupabase;
    } catch (err) {
      logBootstrapFailure("entries", err);
      sourceOffline = true;
    }
    const sqliteEntries = loadSqliteRankedAlbumEntriesForYear(y);
    if (sqliteEntries.length > 0) {
      corpusSource = "sqlite";
      console.warn(`[portal/bootstrap] entries_sqlite_fallback year=${y} count=${sqliteEntries.length}`);
    }
    return sqliteEntries;
  };

  try {
    const preferred = await loadEntriesForYear(VIEWER_BOOTSTRAP_DEFAULT_YEAR);
    if (preferred.length > 0) {
      chosenYear = VIEWER_BOOTSTRAP_DEFAULT_YEAR;
      entries = preferred;
    } else if (years.length > 0) {
      for (const y of years) {
        const next = await loadEntriesForYear(y);
        if (next.length > 0) {
          chosenYear = y;
          entries = next;
          break;
        }
      }
    }
  } catch (err) {
    logBootstrapFailure("entries", err);
    entries = [];
    sourceOffline = true;
  }

  const albumIds = entries.map((e) => e.albumId);
  const startIndex = 0;
  const windowIds = [0, 1, 2, 3, 4]
    .map((i) => (i < albumIds.length ? albumIds[i]! : null))
    .filter((id): id is string => typeof id === "string");

  const rvalIds = windowIds.filter((id) => !isSqliteCorpusAlbumId(id));
  const sqliteIds = windowIds.filter((id) => isSqliteCorpusAlbumId(id));

  let hydrated: DiscoverStableAlbumRow[] = [];
  if (sqliteIds.length > 0) {
    hydrated = hydrateSqliteAlbumRows(sqliteIds, chosenYear);
  }
  if (rvalIds.length > 0) {
    try {
      const fromSupabase = await hydrateDiscoverAlbumRows(rvalIds);
      hydrated = [...hydrated, ...fromSupabase];
    } catch (err) {
      logBootstrapFailure("hydrated", err);
      sourceOffline = true;
      if (hydrated.length === 0 && entries.length > 0) {
        hydrated = hydrateSqliteAlbumRows(windowIds, chosenYear);
        corpusSource = "sqlite";
      }
    }
  }

  if (years.length === 0 && entries.length === 0) {
    sourceOffline = true;
  }

  return {
    years,
    year: chosenYear,
    entries,
    albumIds,
    startIndex,
    hydrated,
    corpusSource,
    ...(sourceOffline ? { sourceOffline: true } : {}),
  };
}

/**
 * The home/`/` page renders the portal and calls this on every cold request.
 * Bootstrap output is identical for every visitor (no per-user data yet), so
 * we cache the whole composition for 1 hour. Underlying pieces are already
 * tagged (`viewer-distinct-years`, `viewer-year-albums:<y>`, per-album
 * `artwork:<id>`), so a manual `revalidateTag("viewer-bootstrap")` from a
 * data-import script will refresh everything on the next render.
 */
export async function loadViewerBootstrap(): Promise<ViewerBootstrap> {
  try {
    return await unstable_cache(
      loadViewerBootstrapImpl,
      ["viewer-bootstrap"],
      {
        revalidate: 60 * 60,
        tags: ["viewer-bootstrap", CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG],
      },
    )();
  } catch (err) {
    logBootstrapFailure("cache_wrapper", err);
    return emptyViewerBootstrap();
  }
}
