export type IntegrityView =
  | "artists"
  | "families"
  | "variants"
  | "relationships"
  | "albums"
  | "album-families"
  | "editions"
  | "b200"
  | "tracklists";

export type AlbumListItem = {
  id: number;
  title: string;
  artist_name: string;
  release_year: number | null;
  edition_count: number;
  track_count: number;
  b200_chart_rows: number;
};

export type AlbumDetail = {
  id: number;
  title: string;
  artist_id: number;
  artist_name: string;
  release_year: number | null;
  editions: Array<{
    id: number;
    edition_name: string;
    release_year: number | null;
    is_canonical: boolean;
  }>;
  lineage: AlbumTracklistRow[];
  b200: AlbumB200Row[];
  families: Array<{
    track_family_id: number;
    track_family_name: string;
    member_count: number;
  }>;
};

export type AlbumB200Row = {
  chart_date: string;
  chart_position: number | null;
  weeks_on_chart: number | null;
  album_title?: string;
  artist_name?: string;
};

export type AlbumPopulationRow = {
  proposed_album_key: string;
  canonical_album_name: string;
  artist_name: string;
  album_id: number | null;
  staging_row_count: number | null;
  edition_count: number;
  first_chart_date: string | null;
  last_chart_date: string | null;
};

export type AlbumEditionRow = {
  edition_id: number;
  album_id: number;
  album_title: string;
  artist_name: string;
  edition_name: string;
  release_year: number | null;
  is_canonical: boolean;
};

export type B200TimelineRow = {
  album_id: number;
  album_title: string;
  artist_name: string;
  chart_weeks: number;
  peak_position: number | null;
  first_chart_date: string | null;
  last_chart_date: string | null;
};

export type AlbumTracklistRow = {
  disc_number: number | null;
  track_number: number | null;
  sequence_index: number | null;
  track_family_name: string | null;
  track_title: string | null;
  source_provenance: string;
  relationship_type: string | null;
  is_primary_recording: boolean | null;
  album_title?: string;
  artist_name?: string;
};

export type ArtistListItem = {
  id: number;
  canonical_name: string;
  family_count: number;
  track_count: number;
};

export type ArtistSummary = {
  id: number;
  canonical_name: string;
  family_count: number;
  track_count: number;
  variant_count: number;
};

export type FamilyRow = {
  id: number;
  canonical_name: string;
  track_count: number;
  primary_recording: string | null;
  variant_count: number;
};

export type FamilyMemberRow = {
  track_id: number;
  title: string;
  relationship_type: string;
  is_primary_recording: boolean;
  variant_classification: string;
  chart_row_count: number;
};

export type FamilyDetail = {
  id: number;
  canonical_name: string;
  normalized_family_key: string;
  artist_id: number;
  artist_name: string;
  members: FamilyMemberRow[];
};

export type RelationshipRow = {
  track_a_id: number;
  track_a_title: string;
  track_b_id: number;
  track_b_title: string;
  family_name: string;
  relationship_type: string;
  confidence_score: number;
};

export type ExplorerData = {
  artists: ArtistListItem[];
  artist: ArtistSummary | null;
  families: FamilyRow[];
  familyDetail: FamilyDetail | null;
  relationships: RelationshipRow[];
  albums: AlbumListItem[];
  albumDetail: AlbumDetail | null;
  b200Rows: AlbumB200Row[];
  b200Timelines: B200TimelineRow[];
  albumPopulationRows: AlbumPopulationRow[];
  editionRows: AlbumEditionRow[];
  tracklistRows: AlbumTracklistRow[];
  selectedArtistId: number | null;
  selectedFamilyId: number | null;
  selectedAlbumId: number | null;
  searchQ: string;
  view: IntegrityView;
};
