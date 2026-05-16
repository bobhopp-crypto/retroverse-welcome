/**
 * Local-first artist universe artifact (parallel to album dossiers).
 */

export type ArtistYearRankingRef = {
  year: number;
  retroverse_artist_rank: number;
  artist_retroscope_key: string;
  peak_momentum_score: number;
  best_album_rank: number | null;
  best_track_rank: number | null;
  dominant_album_ids: string[];
  dominant_track_ids: string[];
};

export type ArtistUniverseAlbumRef = {
  album_id: string;
  title: string;
  href: string;
  release_year: number | null;
};

export type ArtistUniverseTrackRef = {
  id: string;
  title: string;
  album_id: string;
  album_title: string;
  album_href: string;
  release_year: number | null;
  peak_chart_position: number | null;
};

export type ArtistRetroverseSummary = {
  ranked_year_count: number;
  best_year: number | null;
  best_year_rank: number | null;
  peak_momentum_score: number;
  top_coordinate: string | null;
};

export type ArtistSignalPalette = {
  hue: number;
  accent: string;
};

export type ArtistUniverseRecord = {
  artist_id: string;
  display_name: string;
  slug: string;
  active_years: { first: number | null; last: number | null };
  yearly_rankings: ArtistYearRankingRef[];
  dominant_years: number[];
  retroverse_summary: ArtistRetroverseSummary;
  primary_albums: ArtistUniverseAlbumRef[];
  primary_tracks: ArtistUniverseTrackRef[];
  navigation_coordinates: string[];
  discography_album_ids: string[];
  dossier_summary: { album_count: number; track_count: number } | null;
  signal_palette: ArtistSignalPalette;
  source_notes: string[];
};

export type ArtistUniverseIndexRow = {
  artist_id: string;
  display_name: string;
  slug: string;
  album_count: number;
  ranked_year_count: number;
  dominant_years: number[];
  active_first: number | null;
  active_last: number | null;
  signal_hue: number;
};

export type ArtistUniverseFile = {
  version: 1;
  generated_at: string;
  source: string;
  artist_count: number;
  /** slug → record */
  artists_by_slug: Record<string, ArtistUniverseRecord>;
  /** artist_id (RVAR or slug:…) → slug */
  artists_by_id: Record<string, string>;
  index: ArtistUniverseIndexRow[];
};
