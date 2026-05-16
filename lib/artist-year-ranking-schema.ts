/**
 * Canonical yearly artist dominance layer (parallel to album RetroScope rank).
 * One roster per calendar year — not lifetime popularity.
 */

export type ArtistYearScoreBreakdown = {
  album_component: number;
  track_component: number;
  weeks_component: number;
  concurrency_multiplier: number;
  retroscope_presence_bonus: number;
  raw_total: number;
};

export type ArtistYearPresence = {
  artist_id: string;
  artist_name: string;
  year: number;
  /** 1-based dominance rank within the year (Retroverse artist rank). */
  retroverse_artist_rank: number;
  /** Spatial key for future RetroScope artist layer (`1977:A1` ≠ album `1977:1`). */
  artist_retroscope_key: string;

  total_album_presence: number;
  total_track_presence: number;
  total_chart_weeks: number;

  best_album_rank: number | null;
  best_track_rank: number | null;

  dominant_album_ids: string[];
  dominant_track_ids: string[];

  peak_momentum_score: number;
  score_breakdown: ArtistYearScoreBreakdown;
};

export type ArtistYearRankingsFile = {
  version: 1;
  generated_at: string;
  source: string;
  /** Years included (sorted ascending). */
  years: number[];
  /** Top N stored per year (full inspection may export more in CSV). */
  top_n_per_year: number;
  by_year: Record<string, ArtistYearPresence[]>;
};

export function artistRetroscopeKey(year: number, retroverseArtistRank: number): string {
  return `${year}:A${retroverseArtistRank}`;
}
