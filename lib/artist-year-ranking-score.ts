import { retroverseAlbumChartAppearances } from "@/lib/billboard-album-chart-appearance";

import type { ArtistYearScoreBreakdown } from "@/lib/artist-year-ranking-schema";

export const ARTIST_RANK_INVERSE_MAX = 200;

/** Hot 100 / singles charts (inverse of album-chart gate). */
export function isHot100ChartName(chartName: string): boolean {
  const n = chartName.trim().toLowerCase();
  if (retroverseAlbumChartAppearances(chartName)) return false;
  return /\bhot\b\s*100\b|hot100/.test(n);
}

export function inverseChartWeight(peakPosition: number, maxRank = ARTIST_RANK_INVERSE_MAX): number {
  const p = Math.max(1, Math.min(maxRank, Math.round(peakPosition)));
  return (maxRank + 1 - p) / maxRank;
}

export type AlbumPresenceInput = {
  albumId: string;
  peakChartPosition: number;
  chartRowCount: number;
  maxWeeksOnChart: number;
  /** RetroScope album slot rank when present on the spatial grid. */
  retroscopeAlbumRank?: number | null;
};

export type TrackPresenceInput = {
  trackId: string;
  peakChartPosition: number;
  chartRowCount: number;
  maxWeeksOnChart: number;
};

export function computeArtistYearScoreBreakdown(input: {
  albums: AlbumPresenceInput[];
  tracks: TrackPresenceInput[];
}): ArtistYearScoreBreakdown {
  let albumComponent = 0;
  let weeksComponent = 0;
  let albumsPeakTop10 = 0;
  let albumsPeakOne = 0;

  for (const al of input.albums) {
    const w = inverseChartWeight(al.peakChartPosition);
    const weeksBoost = 1 + Math.log1p(Math.max(0, al.maxWeeksOnChart)) * 0.12;
    const densityBoost = 1 + Math.log1p(Math.max(0, al.chartRowCount)) * 0.06;
    let slice = w * weeksBoost * densityBoost * 4.0;
    if (al.peakChartPosition === 1) {
      slice += 3.5;
      albumsPeakOne += 1;
    } else if (al.peakChartPosition <= 10) {
      slice += 1.2;
      albumsPeakTop10 += 1;
    }
    if (al.retroscopeAlbumRank != null && al.retroscopeAlbumRank <= 20) {
      slice += inverseChartWeight(al.retroscopeAlbumRank) * 0.85;
    }
    albumComponent += slice;
    weeksComponent += al.maxWeeksOnChart * 0.04 + al.chartRowCount * 0.02;
  }

  let trackComponent = 0;
  let tracksPeakTop10 = 0;
  for (const tr of input.tracks) {
    const w = inverseChartWeight(tr.peakChartPosition) * 0.9;
    const weeksBoost = 1 + Math.log1p(Math.max(0, tr.maxWeeksOnChart)) * 0.1;
    const densityBoost = 1 + Math.log1p(Math.max(0, tr.chartRowCount)) * 0.05;
    let slice = w * weeksBoost * densityBoost * 2.2;
    if (tr.peakChartPosition === 1) slice += 2.0;
    else if (tr.peakChartPosition <= 10) {
      slice += 0.8;
      tracksPeakTop10 += 1;
    }
    trackComponent += slice;
    weeksComponent += tr.maxWeeksOnChart * 0.025 + tr.chartRowCount * 0.015;
  }

  const concurrentAlbumHits = albumsPeakTop10 + (albumsPeakOne > 0 ? 2 : 0);
  const concurrentTrackHits = tracksPeakTop10;
  const concurrentEntries = input.albums.length + input.tracks.length;
  const concurrencyMultiplier =
    1 +
    Math.max(0, concurrentAlbumHits - 1) * 0.18 +
    Math.max(0, concurrentTrackHits - 1) * 0.08 +
    Math.max(0, concurrentEntries - 2) * 0.04;

  const retroscopePresenceBonus =
    input.albums.filter((a) => a.retroscopeAlbumRank != null).length > 0 ? 0.35 : 0;

  const rawTotal =
    (albumComponent + trackComponent + weeksComponent + retroscopePresenceBonus) * concurrencyMultiplier;

  return {
    album_component: Number(albumComponent.toFixed(4)),
    track_component: Number(trackComponent.toFixed(4)),
    weeks_component: Number(weeksComponent.toFixed(4)),
    concurrency_multiplier: Number(concurrencyMultiplier.toFixed(4)),
    retroscope_presence_bonus: Number(retroscopePresenceBonus.toFixed(4)),
    raw_total: Number(rawTotal.toFixed(4)),
  };
}
