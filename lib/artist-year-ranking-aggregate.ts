import type { ArtistYearPresence, ArtistYearRankingsFile } from "@/lib/artist-year-ranking-schema";
import { artistRetroscopeKey } from "@/lib/artist-year-ranking-schema";
import { isGenericArtistBucket } from "@/lib/artist-identity-resolve";
import {
  computeArtistYearScoreBreakdown,
  type AlbumPresenceInput,
  type TrackPresenceInput,
} from "@/lib/artist-year-ranking-score";

export type { ArtistIdentity } from "@/lib/artist-identity-resolve";
import type { ArtistIdentity } from "@/lib/artist-identity-resolve";

type AlbumSlice = {
  albumId: string;
  peakChartPosition: number;
  chartRowCount: number;
  maxWeeksOnChart: number;
  retroscopeAlbumRank: number | null;
};

type TrackSlice = {
  trackId: string;
  peakChartPosition: number;
  chartRowCount: number;
  maxWeeksOnChart: number;
};

export type ArtistYearAgg = {
  artist: ArtistIdentity;
  year: number;
  albums: Map<string, AlbumSlice>;
  tracks: Map<string, TrackSlice>;
};

export type ArtistYearRankingBuild = {
  byYear: Map<number, Map<string, ArtistYearAgg>>;
};

export function createArtistYearRankingBuild(): ArtistYearRankingBuild {
  return { byYear: new Map() };
}

function getYearArtistAgg(
  build: ArtistYearRankingBuild,
  year: number,
  artist: ArtistIdentity,
): ArtistYearAgg {
  let yMap = build.byYear.get(year);
  if (!yMap) {
    yMap = new Map();
    build.byYear.set(year, yMap);
  }
  const existing = yMap.get(artist.artist_id);
  if (existing) {
    if (existing.artist.artist_name.length < artist.artist_name.length) {
      existing.artist.artist_name = artist.artist_name;
    }
    return existing;
  }
  const agg: ArtistYearAgg = { artist, year, albums: new Map(), tracks: new Map() };
  yMap.set(artist.artist_id, agg);
  return agg;
}

export function feedArtistAlbumChartRow(
  build: ArtistYearRankingBuild,
  year: number,
  artist: ArtistIdentity,
  albumId: string,
  peak: number,
  weeks: number,
): void {
  if (!Number.isFinite(year) || !albumId || isGenericArtistBucket(artist.artist_name)) return;
  const agg = getYearArtistAgg(build, year, artist);
  const id = albumId.trim().toUpperCase();
  const prev = agg.albums.get(id);
  if (!prev) {
    agg.albums.set(id, {
      albumId: id,
      peakChartPosition: peak,
      chartRowCount: 1,
      maxWeeksOnChart: weeks,
      retroscopeAlbumRank: null,
    });
  } else {
    prev.chartRowCount += 1;
    prev.peakChartPosition = Math.min(prev.peakChartPosition, peak);
    prev.maxWeeksOnChart = Math.max(prev.maxWeeksOnChart, weeks);
  }
}

export function feedArtistTrackChartRow(
  build: ArtistYearRankingBuild,
  year: number,
  artist: ArtistIdentity,
  trackId: string,
  peak: number,
  weeks: number,
): void {
  if (!Number.isFinite(year) || !trackId || isGenericArtistBucket(artist.artist_name)) return;
  const agg = getYearArtistAgg(build, year, artist);
  const id = trackId.trim().toUpperCase();
  const prev = agg.tracks.get(id);
  if (!prev) {
    agg.tracks.set(id, {
      trackId: id,
      peakChartPosition: peak,
      chartRowCount: 1,
      maxWeeksOnChart: weeks,
    });
  } else {
    prev.chartRowCount += 1;
    prev.peakChartPosition = Math.min(prev.peakChartPosition, peak);
    prev.maxWeeksOnChart = Math.max(prev.maxWeeksOnChart, weeks);
  }
}

export function applyRetroscopeAlbumSlot(
  build: ArtistYearRankingBuild,
  year: number,
  artist: ArtistIdentity,
  albumId: string,
  retroscopeAlbumRank: number,
): void {
  if (isGenericArtistBucket(artist.artist_name)) return;
  const agg = getYearArtistAgg(build, year, artist);
  const id = albumId.trim().toUpperCase();
  const prev = agg.albums.get(id);
  if (!prev) {
    agg.albums.set(id, {
      albumId: id,
      peakChartPosition: retroscopeAlbumRank,
      chartRowCount: 0,
      maxWeeksOnChart: 0,
      retroscopeAlbumRank,
    });
  } else {
    prev.retroscopeAlbumRank =
      prev.retroscopeAlbumRank == null
        ? retroscopeAlbumRank
        : Math.min(prev.retroscopeAlbumRank, retroscopeAlbumRank);
    prev.peakChartPosition = Math.min(prev.peakChartPosition, retroscopeAlbumRank);
  }
}

function aggToPresence(agg: ArtistYearAgg, retroverseArtistRank: number): ArtistYearPresence {
  const albumInputs: AlbumPresenceInput[] = [...agg.albums.values()].map((a) => ({
    albumId: a.albumId,
    peakChartPosition: a.peakChartPosition,
    chartRowCount: a.chartRowCount,
    maxWeeksOnChart: a.maxWeeksOnChart,
    retroscopeAlbumRank: a.retroscopeAlbumRank,
  }));
  const trackInputs: TrackPresenceInput[] = [...agg.tracks.values()].map((t) => ({
    trackId: t.trackId,
    peakChartPosition: t.peakChartPosition,
    chartRowCount: t.chartRowCount,
    maxWeeksOnChart: t.maxWeeksOnChart,
  }));

  const score = computeArtistYearScoreBreakdown({ albums: albumInputs, tracks: trackInputs });

  const bestAlbumRank =
    albumInputs.length > 0 ? Math.min(...albumInputs.map((a) => a.peakChartPosition)) : null;
  const bestTrackRank =
    trackInputs.length > 0 ? Math.min(...trackInputs.map((t) => t.peakChartPosition)) : null;

  const dominantAlbumIds = [...agg.albums.values()]
    .sort(
      (a, b) =>
        a.peakChartPosition - b.peakChartPosition ||
        b.maxWeeksOnChart - a.maxWeeksOnChart ||
        a.albumId.localeCompare(b.albumId),
    )
    .slice(0, 12)
    .map((a) => a.albumId);

  const dominantTrackIds = [...agg.tracks.values()]
    .sort(
      (a, b) =>
        a.peakChartPosition - b.peakChartPosition ||
        b.maxWeeksOnChart - a.maxWeeksOnChart ||
        a.trackId.localeCompare(b.trackId),
    )
    .slice(0, 12)
    .map((t) => t.trackId);

  const totalChartWeeks =
    [...agg.albums.values()].reduce((s, a) => s + a.maxWeeksOnChart, 0) +
    [...agg.tracks.values()].reduce((s, t) => s + t.maxWeeksOnChart, 0);

  return {
    artist_id: agg.artist.artist_id,
    artist_name: agg.artist.artist_name,
    year: agg.year,
    retroverse_artist_rank: retroverseArtistRank,
    artist_retroscope_key: artistRetroscopeKey(agg.year, retroverseArtistRank),
    total_album_presence: agg.albums.size,
    total_track_presence: agg.tracks.size,
    total_chart_weeks: totalChartWeeks,
    best_album_rank: bestAlbumRank,
    best_track_rank: bestTrackRank,
    dominant_album_ids: dominantAlbumIds,
    dominant_track_ids: dominantTrackIds,
    peak_momentum_score: score.raw_total,
    score_breakdown: score,
  };
}

export function finalizeArtistYearRankings(
  build: ArtistYearRankingBuild,
  opts: { source: string; topNPerYear: number; yearFilter?: (y: number) => boolean },
): ArtistYearRankingsFile {
  const years = [...build.byYear.keys()]
    .filter((y) => (opts.yearFilter ? opts.yearFilter(y) : true))
    .sort((a, b) => a - b);

  const by_year: Record<string, ArtistYearPresence[]> = {};

  for (const year of years) {
    const yMap = build.byYear.get(year);
    if (!yMap) continue;
    const scored = [...yMap.values()]
      .map((agg) => {
        const breakdown = computeArtistYearScoreBreakdown({
          albums: [...agg.albums.values()].map((a) => ({
            albumId: a.albumId,
            peakChartPosition: a.peakChartPosition,
            chartRowCount: a.chartRowCount,
            maxWeeksOnChart: a.maxWeeksOnChart,
            retroscopeAlbumRank: a.retroscopeAlbumRank,
          })),
          tracks: [...agg.tracks.values()].map((t) => ({
            trackId: t.trackId,
            peakChartPosition: t.peakChartPosition,
            chartRowCount: t.chartRowCount,
            maxWeeksOnChart: t.maxWeeksOnChart,
          })),
        });
        return { agg, raw: breakdown.raw_total };
      })
      .sort(
        (a, b) =>
          b.raw - a.raw ||
          a.agg.artist.artist_name.localeCompare(b.agg.artist.artist_name, "en", { sensitivity: "base" }) ||
          a.agg.artist.artist_id.localeCompare(b.agg.artist.artist_id),
      );

    const capped = scored.slice(0, opts.topNPerYear);
    by_year[String(year)] = capped.map((row, i) => aggToPresence(row.agg, i + 1));
  }

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    source: opts.source,
    years,
    top_n_per_year: opts.topNPerYear,
    by_year,
  };
}
