import { discoverReviewSortRank, loadDiscoverReviewMap } from "@/lib/discover-review-state";
import { interleavePreferringCovers } from "@/lib/discover-feed-ordering";
import { getCachedDiscoverAlbumIdList } from "@/lib/discover-order-cache";
import { hydrateDiscoverAlbumRows } from "@/lib/discover-hydrate-rows";
import { getAllEras, getEraBySlug } from "@/lib/eras";

import type {
  DiscoverEraNav,
  DiscoverFeedStats,
  DiscoverPagination,
  DiscoverStableAlbumRow,
} from "./discover-feed-types";
import { DISCOVER_ALBUMS_PER_PAGE } from "./discover-feed-types";

const ALL_ERA_SLUG = "all";
/**
 * Hydrate this many consecutive ids from the cached global order, then interleave/sort
 * and take the first page slice — avoids scanning artwork for the full corpus.
 */
const DISCOVER_HYDRATE_WINDOW = 48;

function normalizeEraSlug(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (s === ALL_ERA_SLUG || s === "") return ALL_ERA_SLUG;
  return getEraBySlug(s) ? s : ALL_ERA_SLUG;
}

function buildHomeNav(): DiscoverEraNav {
  return {
    headline: "Discover",
    subline: "Twelve albums at a time — chart memories, slow and deliberate.",
    listBasePath: "/",
    prevEraSlug: null,
    nextEraSlug: null,
  };
}

function buildEraStreamNav(eraSlug: string): DiscoverEraNav {
  const eras = getAllEras();
  const era = getEraBySlug(eraSlug)!;
  const idx = eras.findIndex((e) => e.slug === eraSlug);
  const prevEraSlug = idx <= 0 ? null : eras[idx - 1]!.slug;
  const nextEraSlug = idx < 0 || idx >= eras.length - 1 ? null : eras[idx + 1]!.slug;

  return {
    headline: era.title,
    subline: `${era.years} · ${era.subtitle}`,
    listBasePath: `/eras/${eraSlug}`,
    prevEraSlug,
    nextEraSlug,
  };
}

/** After curator rank: verified cover → provisional cover → no cover. */
function feedCoverTier(row: DiscoverStableAlbumRow): number {
  if (!row.canonicalCoverPath?.trim()) return 2;
  if (row.trustState === "verified") return 0;
  return 1;
}

function rankHydratedWindow(
  rows: DiscoverStableAlbumRow[],
  windowIds: string[],
  reviewMap: Record<string, import("@/lib/discover-review-state").DiscoverReviewMark | undefined>,
): DiscoverStableAlbumRow[] {
  const orderById = new Map(windowIds.map((id, index) => [id, index]));
  const batch = [...rows];
  batch.sort((a, b) => {
    const ra = discoverReviewSortRank(reviewMap[a.albumId]);
    const rb = discoverReviewSortRank(reviewMap[b.albumId]);
    if (ra !== rb) return ra - rb;
    const ta = feedCoverTier(a);
    const tb = feedCoverTier(b);
    if (ta !== tb) return ta - tb;
    return (orderById.get(a.albumId) ?? 0) - (orderById.get(b.albumId) ?? 0);
  });
  return interleavePreferringCovers(batch);
}

export type DiscoverFeedParams = {
  page: number;
  /** `all` = full Discover home stream; otherwise a valid era slug. */
  eraSlug: string;
};

export async function loadDiscoverStableFeed(params: DiscoverFeedParams): Promise<{
  rows: DiscoverStableAlbumRow[];
  stats: DiscoverFeedStats;
  pagination: DiscoverPagination;
  eraNav: DiscoverEraNav;
}> {
  const eraSlug = normalizeEraSlug(params.eraSlug);
  const pageSize = DISCOVER_ALBUMS_PER_PAGE;
  const eraNav = eraSlug === ALL_ERA_SLUG ? buildHomeNav() : buildEraStreamNav(eraSlug);

  const idList = await getCachedDiscoverAlbumIdList(eraSlug);
  if (idList.length === 0) {
    return {
      rows: [],
      stats: { totalRows: 0, albumRows: 0, gapRows: 0, rowsWithCover: 0, albumsInScope: 0 },
      pagination: { page: 1, pageSize, totalAlbums: 0, totalPages: 1 },
      eraNav,
    };
  }

  const totalAlbums = idList.length;
  const totalPages = Math.max(1, Math.ceil(totalAlbums / pageSize));
  const page = Math.min(Math.max(1, params.page), totalPages);
  const startIdx = (page - 1) * pageSize;
  const windowIds = idList.slice(startIdx, startIdx + DISCOVER_HYDRATE_WINDOW);

  const [hydrated, reviewMap] = await Promise.all([hydrateDiscoverAlbumRows(windowIds), loadDiscoverReviewMap()]);
  const rankedWindow = rankHydratedWindow(hydrated, windowIds, reviewMap);
  const pageSlice = rankedWindow.slice(0, pageSize);

  const stats: DiscoverFeedStats = {
    totalRows: pageSlice.length,
    albumRows: pageSlice.length,
    gapRows: 0,
    rowsWithCover: pageSlice.filter((r) => Boolean(r.canonicalCoverPath?.trim())).length,
    albumsInScope: totalAlbums,
  };

  return {
    rows: pageSlice,
    stats,
    pagination: { page, pageSize, totalAlbums, totalPages },
    eraNav,
  };
}
