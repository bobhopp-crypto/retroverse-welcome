export const RETROSCOPE_YEAR_MIN = 1965;
export const RETROSCOPE_YEAR_MAX = 1995;
export const RETROSCOPE_WORLD_YEAR_MIN = 1950;
export const RETROSCOPE_WORLD_YEAR_MAX = 2030;
export const RETROSCOPE_GRID_COLS = 7;
/** Desktop / wide fallback viewport height in cells. */
export const RETROSCOPE_GRID_ROWS = 10;
/** Mobile visible viewport only (universe logic unchanged). */
export const RETROSCOPE_GRID_ROWS_MOBILE = 5;
export const RETROSCOPE_RANK_MAX = 200;

export type RetroscopeCellDTO = {
  chartYear: number;
  retroverseRank: number;
  /** Album, artist, or track entity payload. */
  entityKind: "album" | "artist" | "track";
  /** Stable entity id (RVAL… or slug:…). */
  entityId: string;
  /** Primary line (album title or artist name). */
  title: string;
  /** Secondary line (album artist or rank coordinate). */
  artist: string;
  releaseYear: number | null;
  canonicalCoverPath: string | null;
  /** Override `updated_at` — busts browser/CDN cache after curator save. */
  canonicalCoverCacheBust?: string | null;
  trustState: "verified" | "provisional" | "unresolved";
  sourceNote: string | null;
  /** From materialized runtime (materialize_retroscope_runtime.py). */
  trustScore?: number;
  identityState?: string;
  /** @deprecated Use entityId — album id for album cells. */
  albumId: string;
  /** Artist RetroScope (`1977:A1`). */
  artistRetroscopeKey?: string;
  artistSlug?: string;
  signalHue?: number;
  signalHueSecondary?: number;
  signalAccent?: string;
  signalAccentWarm?: string;
  signalBloom?: string;
  signalDescriptor?: string;
  dominantYears?: number[];
  peakMomentumScore?: number;
  rankedYearCount?: number;
  activeYearsFirst?: number | null;
  activeYearsLast?: number | null;
  primaryAlbumTitles?: string[];
  primaryTrackTitles?: string[];
};

export function retroscopeCellKey(chartYear: number, retroverseRank: number): string {
  return `${chartYear}:${retroverseRank}`;
}
