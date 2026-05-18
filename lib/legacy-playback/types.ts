import type { PlaybackTarget } from "./playback";
import type { TrackPlayButtonModel, TrackPlaySourceType } from "./track-play-button-state";

export type LegacyPlaybackResolveInput = {
  artist: string;
  title: string;
  retroverseTrackId?: string | null;
};

export type LegacyPlaybackResolveResult = {
  input: LegacyPlaybackResolveInput;
  playbackKey: string;
  cacheHit: boolean;
  cacheLoadedFrom: string | null;
  cacheEntryCount: number;
  sources: {
    r2?: { url: string };
    youtube?: { videoId: string };
  };
  target: PlaybackTarget;
  /** Maps target.type: video → local (R2), youtube, search */
  sourceType: TrackPlaySourceType;
  playButton: TrackPlayButtonModel;
  merged: {
    video_url?: string;
    youtube_id?: string;
    thumbnail?: string | null;
    play_count?: number;
  };
};
