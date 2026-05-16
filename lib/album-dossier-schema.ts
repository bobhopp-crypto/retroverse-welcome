/** Local album dossier (`album-dossiers.json` from materialize_album_dossiers.py). */

export type AlbumDossierIdentity = {
  artist: string;
  album: string;
  chart_year: number;
  chart_rank: number;
  chart_date?: string;
  canonical_cover_path: string | null;
  trust_state?: string;
  trust_score?: number;
  identity_state?: string;
  retroscope_key: string;
};

export type AlbumDossierChart = {
  peak_rank: number | null;
  weeks_on_chart: number | null;
  first_chart_date?: string | null;
  last_chart_date?: string | null;
  retroscope_snapshot_rank: number;
  retroscope_snapshot_year: number;
  nearby_snapshot_positions: Array<Record<string, unknown>>;
};

export type DossierTrackMusicBrainz = {
  position?: number | null;
  length_ms?: number | null;
  recording_mbid?: string | null;
  medium_mbid?: string | null;
  release_mbid?: string | null;
  work_mbid?: string | null;
  disambiguation?: string | null;
};

export type AlbumDossierTrack = {
  title: string;
  acousticness?: number | null;
  danceability?: number | null;
  duration_ms?: number | null;
  energy?: number | null;
  instrumentalness?: number | null;
  key?: number | null;
  key_label?: string | null;
  liveness?: number | null;
  loudness?: number | null;
  mode?: number | null;
  speechiness?: number | null;
  tempo?: number | null;
  time_signature?: number | null;
  valence?: number | null;
  spotify_album_id?: string | null;
  spotify_track_id?: string | null;
  musicbrainz?: DossierTrackMusicBrainz;
  retroverse_score?: number | null;
};

export type AlbumDossierAcoustic = {
  track_count: number;
  /** Raw `acoustic_features` row count before per-title dedupe. */
  raw_feature_row_count?: number;
  means: Record<string, number | null>;
  descriptors: string[];
  editorial_summary: string;
  tracks: AlbumDossierTrack[];
};

/** Optional Retroverse pathway / ranking scores from local sidecar (`dossier-retroverse-scores-by-rval.json`). */
export type AlbumDossierScores = {
  album_retroverse_score?: number | null;
  tracks?: Array<{ title_norm?: string; retroverse_score?: number | null }>;
};

export type AlbumDossierMusicBrainz = {
  release_mbid?: string;
};

export type AlbumDossierRelatedStub = {
  albumId: string;
  artist?: string;
  album?: string;
  chartYear?: number;
  chartRank?: number;
};

export type AlbumDossierRelated = {
  same_artist_albums: AlbumDossierRelatedStub[];
  adjacent_year_same_rank: AlbumDossierRelatedStub[];
  adjacent_rank_same_year: AlbumDossierRelatedStub[];
};

export type AlbumDossier = {
  version: number;
  generated_at: string;
  albumId: string;
  identity: AlbumDossierIdentity;
  chart: AlbumDossierChart;
  acoustic: AlbumDossierAcoustic;
  related: AlbumDossierRelated;
  scores?: AlbumDossierScores;
  musicbrainz?: AlbumDossierMusicBrainz;
};

export type AlbumDossierBundleFile = {
  version: number;
  generated_at: string;
  source_db?: string;
  dossier_count: number;
  dossiers: Record<string, AlbumDossier>;
};
