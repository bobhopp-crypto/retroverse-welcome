/**
 * Deterministic sort for Retroverse Rank (portal + inspection reports).
 * Billboard **album chart** appearance aggregates (not Hot 100 singles) — see `retroverseAlbumChartAppearances`.
 * Order: peak ASC → weeks DESC → weekly rows DESC → first chart date ASC → artist → album → albumId.
 */
export type PortalYearRankSortKey = {
  peakChartPosition: number;
  weeksOnChart: number;
  weeklyChartRows: number;
  firstChartDate: string;
  artist: string;
  album: string;
  albumId: string;
};

export function comparePortalYearAlbumRank(a: PortalYearRankSortKey, b: PortalYearRankSortKey): number {
  const c0 = a.peakChartPosition - b.peakChartPosition;
  if (c0 !== 0) return c0;
  const c1 = b.weeksOnChart - a.weeksOnChart;
  if (c1 !== 0) return c1;
  const c2 = b.weeklyChartRows - a.weeklyChartRows;
  if (c2 !== 0) return c2;
  const c3 = a.firstChartDate.localeCompare(b.firstChartDate);
  if (c3 !== 0) return c3;
  const c4 = a.artist.localeCompare(b.artist, "en", { sensitivity: "base" });
  if (c4 !== 0) return c4;
  const c5 = a.album.localeCompare(b.album, "en", { sensitivity: "base" });
  if (c5 !== 0) return c5;
  return a.albumId.localeCompare(b.albumId);
}
