import type { PanelResult } from "./panel-result";

export type { PanelResult, PanelStatus } from "./panel-result";

export type RelationshipWorkspaceSource = {
  artist: string;
  title: string;
  retroverseTrackId: string | null;
  chartWeek: string | null;
  chartRank: number | null;
  vdjPath: string | null;
  freeText: string | null;
};

export type ChartPanelEntry = {
  issueDate: string;
  rank: number;
  peakPos: number | null;
  weeksOnChart: number | null;
  lastWeek: number | null;
  title: string;
  artist: string;
  workId: string;
  score: number;
  reason: string;
};

export type RvtrPanelEntry = {
  retroverseTrackId: string;
  canonicalTitle: string;
  canonicalArtist: string;
  retroverseArtistId: string;
  confidence: number;
  reason: string;
};

export type AlbumPanelEntry = {
  retroverseAlbumId: string;
  albumTitle: string;
  artist: string;
  releaseYear: number | null;
  trackTitle: string;
  score: number;
  reason: string;
};

export type ArtistPanelEntry = {
  retroverseArtistId: string;
  canonicalArtistName: string;
  aliases: string[];
  score: number;
  reason: string;
};

export type VdjPanelEntry = {
  title: string;
  artist: string;
  filePath: string;
  normalizedKey: string;
  score: number;
  reason: string;
  remix: string | null;
  album: string | null;
  year: string | null;
};

export type R2PanelEntry = {
  mediaUrl: string | null;
  mediaKey: string;
  playable: boolean;
  sourceType: string;
  matchedBy: string;
  score: number;
  vdjPathMatch: boolean | null;
};

export type RelationshipWorkspacePayload = {
  ok: true;
  source: RelationshipWorkspaceSource;
  /** @deprecated use panels.vdj.meta.databasePath */
  vdjDatabasePath: string | null;
  charts: PanelResult<ChartPanelEntry>;
  rvtr: PanelResult<RvtrPanelEntry>;
  albums: PanelResult<AlbumPanelEntry>;
  artists: PanelResult<ArtistPanelEntry>;
  vdj: PanelResult<VdjPanelEntry>;
  r2: PanelResult<R2PanelEntry>;
};
