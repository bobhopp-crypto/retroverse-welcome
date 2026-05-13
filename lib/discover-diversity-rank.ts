import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";

/** Priority: lower sorts earlier. unseen+covered → unseen+uncovered → seen+covered → seen+uncovered */
export function discoverDiversityTier(row: DiscoverStableAlbumRow, seen: Set<string>): number {
  const isSeen = seen.has(row.albumId);
  const covered = Boolean(row.canonicalCoverPath?.trim());
  if (!isSeen && covered) return 0;
  if (!isSeen && !covered) return 1;
  if (isSeen && covered) return 2;
  return 3;
}

export function rankDiscoverRowsClientSide(
  rows: DiscoverStableAlbumRow[],
  seen: Set<string>,
  hidden: Set<string>,
  snoozedIds: Set<string>,
): DiscoverStableAlbumRow[] {
  return rows
    .filter((r) => !hidden.has(r.albumId) && !snoozedIds.has(r.albumId))
    .map((r, index) => ({ r, index, tier: discoverDiversityTier(r, seen) }))
    .sort((a, b) => (a.tier !== b.tier ? a.tier - b.tier : a.index - b.index))
    .map((x) => x.r);
}
