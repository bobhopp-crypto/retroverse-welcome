import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";

/** Covered albums per one uncovered slot (when uncovered still available). */
const COVER_BATCH = 8;

function hasCoverRow(row: DiscoverStableAlbumRow): boolean {
  return Boolean(row.canonicalCoverPath?.trim());
}

/**
 * Preserves relative order within covered / uncovered groups.
 */
export function interleavePreferringCovers(rows: DiscoverStableAlbumRow[]): DiscoverStableAlbumRow[] {
  if (rows.length === 0) return rows;
  const covered: DiscoverStableAlbumRow[] = [];
  const uncovered: DiscoverStableAlbumRow[] = [];
  for (const row of rows) {
    if (hasCoverRow(row)) covered.push(row);
    else uncovered.push(row);
  }
  if (uncovered.length === 0) return covered;
  if (covered.length === 0) return uncovered;

  const out: DiscoverStableAlbumRow[] = [];
  let ci = 0;
  let ui = 0;

  while (ci < covered.length) {
    for (let k = 0; k < COVER_BATCH && ci < covered.length; k++) {
      out.push(covered[ci]!);
      ci += 1;
    }
    if (ui < uncovered.length) {
      out.push(uncovered[ui]!);
      ui += 1;
    }
  }
  while (ui < uncovered.length) {
    out.push(uncovered[ui]!);
    ui += 1;
  }
  return out;
}
