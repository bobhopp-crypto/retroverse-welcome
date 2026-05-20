export type IntegrityView =
  | "artists"
  | "families"
  | "variants"
  | "relationships"
  | "albums"
  | "album-families"
  | "editions"
  | "b200"
  | "tracklists"
  | "linkage"
  | "hot100-album"
  | "album-track-links"
  | "media"
  | "media-graph"
  | "vdj"
  | "vdj-assets"
  | "r2-sync"
  | "thumbnail-coverage"
  | "youtube-enrichment"
  | "acoustic-linkage"
  | "acoustic-tracklists"
  | "acoustic-hot100"
  | "acoustic-ambiguous";

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

export type LinkageSummary = {
  ctal_total: number;
  ctal_ok: number;
  chart_links: number;
  chart_ok: number;
  hot100_unresolved: number;
  vdj_staging: number;
  media_assets: number;
};

export type AlbumTrackLinkRow = {
  id: number;
  track_family_name: string;
  artist_name: string;
  album_title: string;
  edition_name: string | null;
  track_number: number | null;
  disc_number: number | null;
  confidence_score: number | null;
  source: string;
  review_flag: string;
};

export type Hot100AlbumLinkRow = {
  id: number;
  chart_date: string;
  chart_position: number | null;
  artist: string;
  track_title: string;
  album_title: string | null;
  confidence_score: number | null;
  review_flag: string;
};

export type MediaGraphSummary = {
  vdj_staging: number;
  media_assets: number;
  vdj_media_assets: number;
  linked_tracks: number;
  thumbnail_refs: number;
  probable_r2: number;
  unresolved_media: number;
  youtube_staging: number;
  youtube_videos: number;
};

export type MediaAssetRow = {
  id: number;
  source_system: string;
  filename: string | null;
  artist_text: string | null;
  title_text: string | null;
  album_text: string | null;
  duration_seconds: number | null;
  vdj_guid: string | null;
  play_count?: number | null;
  r2_media_key?: string | null;
  local_thumbnail_path?: string | null;
  linked?: boolean;
};

export type VdjAssetRow = {
  id: number;
  source_path: string;
  filename: string | null;
  artist_text: string | null;
  title_text: string | null;
  play_count: number | null;
  duration_seconds: number | null;
  vdj_guid: string | null;
  thumbnail_path: string | null;
};

export type R2SyncRow = {
  id: number;
  artist_text: string | null;
  title_text: string | null;
  source_path: string | null;
  probable_r2_media_key: string | null;
  probable_r2_thumbnail_key: string | null;
  missing_thumbnail: boolean;
  missing_r2_asset: boolean;
  sync_status: string;
};

export type ThumbnailCoverageRow = {
  id: number;
  artist_text: string | null;
  title_text: string | null;
  source_path: string | null;
  local_thumbnail_path: string | null;
  r2_thumbnail_key: string | null;
  coverage_status: string;
};

export type YoutubeEnrichmentRow = {
  id: number;
  artist_text: string | null;
  title_text: string | null;
  youtube_url: string | null;
  youtube_video_id: string | null;
  source: string;
  candidate_track_id: number | null;
  confidence_score: number;
  review_flag: string;
};

export type VdjLinkageCandidateRow = {
  vdj_staging_id: number;
  source_path: string;
  artist_text: string | null;
  title_text: string | null;
  candidate_track_id: number | null;
  candidate_track_family_id: number | null;
  candidate_album_id: number | null;
  confidence_score: number | null;
  match_reason: string;
  review_flag: string;
};

export type AcousticLinkageSummary = {
  staging_rows: number;
  candidates: number;
  ok_candidates: number;
  review_candidates: number;
  acoustics_lineage: number;
  acoustics_ctal: number;
  hot100_acoustic_links: number;
  hot100_unresolved: number;
};

export type AcousticTracklistRow = {
  artist_name: string;
  album_title: string;
  source_song: string;
  sequence_index: number | null;
  track_family_name: string | null;
  track_title: string | null;
  review_flag: string | null;
  confidence_score: number | null;
};

export type AcousticAmbiguousRow = {
  source_artist: string;
  source_song: string;
  album_count: number;
  staging_rows: number;
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
  linkageSummary: LinkageSummary | null;
  albumTrackLinks: AlbumTrackLinkRow[];
  hot100AlbumLinks: Hot100AlbumLinkRow[];
  mediaGraphSummary: MediaGraphSummary | null;
  mediaAssets: MediaAssetRow[];
  vdjAssets: VdjAssetRow[];
  vdjCandidates: VdjLinkageCandidateRow[];
  r2SyncRows: R2SyncRow[];
  thumbnailCoverage: ThumbnailCoverageRow[];
  youtubeEnrichment: YoutubeEnrichmentRow[];
  acousticSummary: AcousticLinkageSummary | null;
  acousticTracklists: AcousticTracklistRow[];
  acousticHot100Links: Hot100AlbumLinkRow[];
  acousticAmbiguous: AcousticAmbiguousRow[];
  selectedArtistId: number | null;
  selectedFamilyId: number | null;
  selectedAlbumId: number | null;
  searchQ: string;
  view: IntegrityView;
};
