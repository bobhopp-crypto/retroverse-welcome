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

export type AlbumDossierAcoustic = {
  track_count: number;
  means: Record<string, number | null>;
  descriptors: string[];
  editorial_summary: string;
  tracks: Array<{
    title: string;
    acousticness?: number | null;
    danceability?: number | null;
    energy?: number | null;
    valence?: number | null;
    tempo?: number | null;
  }>;
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
};

export type AlbumDossierBundleFile = {
  version: number;
  generated_at: string;
  source_db?: string;
  dossier_count: number;
  dossiers: Record<string, AlbumDossier>;
};
