import { unstable_cache } from "next/cache";

import { discoverReviewMapFilterIds, loadDiscoverReviewMap } from "@/lib/discover-review-state";
import { eraReleaseYearBounds, getEraBySlug } from "@/lib/eras";
import { loadAllRetroverseAlbumRows } from "@/lib/retroverse-albums-corpus";
import { createClient } from "@/lib/supabase";

import { sortCorpusRowsForDiscoverFeed } from "./discover-feed-order-shared";

const ALL_ERA_SLUG = "all";

function normalizeEraSlug(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (s === ALL_ERA_SLUG || s === "") return ALL_ERA_SLUG;
  return getEraBySlug(s) ? s : ALL_ERA_SLUG;
}

/**
 * Builds the canonical ordered album id list for Discover (billboard-first sort).
 * Cached ~5m; avoids re-pagination and re-sort of the full corpus on every request.
 */
async function buildDiscoverAlbumIdListInternal(eraSlug: string): Promise<string[]> {
  const era = normalizeEraSlug(eraSlug);
  const supabase = createClient();
  const albums = await loadAllRetroverseAlbumRows(supabase);
  const usable = albums.filter((a) => a.retroverse_album_id?.trim() && a.canonical_album_title?.trim());
  const sorted = sortCorpusRowsForDiscoverFeed(usable);

  let rows = sorted;
  if (era !== ALL_ERA_SLUG) {
    const eraObj = getEraBySlug(era);
    const bounds = eraObj ? eraReleaseYearBounds(eraObj) : null;
    if (bounds) {
      rows = rows.filter((row) => row.release_year !== null && row.release_year >= bounds.min && row.release_year <= bounds.max);
    }
  }

  const reviewMap = await loadDiscoverReviewMap();
  return discoverReviewMapFilterIds(rows.map((r) => r.retroverse_album_id), reviewMap);
}

export async function getCachedDiscoverAlbumIdList(eraSlug: string): Promise<string[]> {
  const era = normalizeEraSlug(eraSlug);
  return unstable_cache(
    async () => buildDiscoverAlbumIdListInternal(era),
    ["discover-feed-ordered-ids", era],
    { revalidate: 300 },
  )();
}
