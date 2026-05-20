export type GraphYearAlbum = {
  albumId: string;
  pgAlbumId: number;
  displayRank: number;
  peakChartPosition: number | null;
  weeksOnChart: number | null;
  firstChartDate: string | null;
  artistName: string;
  albumTitle: string;
  releaseYear: number | null;
};

export type GraphAlbumDetail = {
  pgAlbumId: number;
  albumId: string;
  artistName: string;
  albumTitle: string;
  releaseYear: number | null;
  peakChartPosition: number | null;
  weeksOnChart: number | null;
  firstChartDate: string | null;
  lastChartDate: string | null;
  chartWeekCount: number;
  trackFamilyCount: number;
  mediaAssetCount: number;
  canonicalCoverPath: string | null;
  r2CoverKey: string | null;
  coverReviewFlag: string | null;
};

export type GraphAlbumTrackFamily = {
  trackFamilyId: number;
  trackFamilyName: string;
  trackTitle: string | null;
  trackNumber: number | null;
  discNumber: number | null;
  source: string;
};

export type GraphAlbumMediaAsset = {
  id: number;
  artistText: string | null;
  titleText: string | null;
  sourcePath: string | null;
  playCount: number | null;
  linkedTrackId: number | null;
};

export type GraphCoverLink = {
  canonicalCoverPath: string | null;
  localCoverPath: string | null;
  r2CoverKey: string | null;
  reviewFlag: string | null;
  source: string | null;
};

export type GraphCoverSummary = {
  albumsWithLinks: number;
  albumsMissingCovers: number;
  r2CoverLinks: number;
  curatedCovers: number;
  unresolvedCovers: number;
};
