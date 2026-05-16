import { unstable_cache } from "next/cache";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { retroverseAlbumChartAppearances } from "@/lib/billboard-album-chart-appearance";
import { albumIdFromChartAppearanceRow } from "@/lib/chart-appearance-album-id";
import { comparePortalYearAlbumRank } from "@/lib/portal-year-rank-sort";
import { CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG } from "@/lib/canonical-artwork-overrides";
import { hydrateDiscoverAlbumRows } from "@/lib/discover-hydrate-rows";
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
};

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
async function loadViewerDistinctYearsImpl(): Promise<number[]> {
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

export async function loadViewerDistinctYears(): Promise<number[]> {
  return unstable_cache(
    loadViewerDistinctYearsImpl,
    ["viewer-distinct-years"],
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
async function loadViewerRankedAlbumEntriesForYearImpl(year: number): Promise<ViewerYearAlbumEntry[]> {
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
export async function loadViewerRankedAlbumEntriesForYear(year: number): Promise<ViewerYearAlbumEntry[]> {
  return unstable_cache(
    async () => loadViewerRankedAlbumEntriesForYearImpl(year),
    ["viewer-year-albums", String(year)],
    { revalidate: 60 * 60 * 24 * 7, tags: ["viewer-year-albums", `viewer-year-albums:${year}`] },
  )();
}

async function loadViewerBootstrapImpl(): Promise<ViewerBootstrap | null> {
  try {
    const years = await loadViewerDistinctYears();
    if (years.length === 0) return null;

    let chosenYear: number | null = null;
    let entries: ViewerYearAlbumEntry[] = [];

    const preferred = await loadViewerRankedAlbumEntriesForYear(VIEWER_BOOTSTRAP_DEFAULT_YEAR);
    if (preferred.length > 0) {
      chosenYear = VIEWER_BOOTSTRAP_DEFAULT_YEAR;
      entries = preferred;
    } else {
      for (const y of years) {
        const next = await loadViewerRankedAlbumEntriesForYear(y);
        if (next.length > 0) {
          chosenYear = y;
          entries = next;
          break;
        }
      }
    }
    if (chosenYear === null || entries.length === 0) return null;

    const albumIds = entries.map((e) => e.albumId);
    const startIndex = 0;
    const windowIds = [0, 1, 2, 3, 4]
      .map((i) => (i < albumIds.length ? albumIds[i]! : null))
      .filter((id): id is string => typeof id === "string");
    /** Covers: overrides → dossier → Supabase artwork (see `hydrateDiscoverAlbumRows`). */
    const hydrated = await hydrateDiscoverAlbumRows(windowIds);

    return { years, year: chosenYear, entries, albumIds, startIndex, hydrated };
  } catch (e) {
    console.error("[portal] bootstrap failed", e);
    return null;
  }
}

/**
 * The home/`/` page renders the portal and calls this on every cold request.
 * Bootstrap output is identical for every visitor (no per-user data yet), so
 * we cache the whole composition for 1 hour. Underlying pieces are already
 * tagged (`viewer-distinct-years`, `viewer-year-albums:<y>`, per-album
 * `artwork:<id>`), so a manual `revalidateTag("viewer-bootstrap")` from a
 * data-import script will refresh everything on the next render.
 */
export async function loadViewerBootstrap(): Promise<ViewerBootstrap | null> {
  return unstable_cache(
    loadViewerBootstrapImpl,
    ["viewer-bootstrap"],
    {
      revalidate: 60 * 60,
      tags: ["viewer-bootstrap", CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG],
    },
  )();
}
