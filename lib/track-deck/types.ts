export type TrackDeckOwnershipState =
  | "owned"
  | "missing"
  | "partial"
  | "linked"
  | "unmatched";

/** Legacy playback bridge source (music-browser resolver). */
export type TrackDeckPlaybackSource = "local" | "youtube" | "search";

export type TrackDeckWeekMeta = {
  issueDate: string;
  chartSeq: number;
  eventId: string;
};

export type TrackDeckTrackRow = {
  entryId: string;
  workId: string;
  rank: number;
  lastWeek: number | null;
  peakPos: number | null;
  weeksOnChart: number | null;
  title: string;
  artist: string;
  ownership: TrackDeckOwnershipState;
  vdjPath: string | null;
  linkCount: number;
  maxConfidence: number | null;
  playbackSource: TrackDeckPlaybackSource;
  playableUrl: string;
};

export type TrackDeckWeekPayload = {
  week: TrackDeckWeekMeta;
  tracks: TrackDeckTrackRow[];
  stats: {
    total: number;
    owned: number;
    missing: number;
    partial: number;
    linked: number;
    unmatched: number;
  };
};

export type TrackDeckWeekIndex = {
  minDate: string;
  maxDate: string;
  weekCount: number;
  years: Array<{ year: number; weekCount: number }>;
  weeksForYear: string[];
};
