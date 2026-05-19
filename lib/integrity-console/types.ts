export type IntegrityView = "artists" | "families" | "variants" | "relationships";

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
  selectedArtistId: number | null;
  selectedFamilyId: number | null;
  searchQ: string;
  view: IntegrityView;
};
