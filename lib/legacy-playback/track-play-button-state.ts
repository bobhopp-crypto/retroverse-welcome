import type { PlaybackTarget } from "./playback";
import { youtubeVideoIdForInAppEmbed } from "./playback";

export type TrackPlaySourceType = "local" | "youtube" | "search";

export type TrackPlayButtonModel = {
  sourceType: TrackPlaySourceType;
  isPlaying: boolean;
  disabled: boolean;
};

export function playbackToSourceType(playback: PlaybackTarget): TrackPlaySourceType {
  if (playback.type === "video") return "local";
  if (playback.type === "youtube") return "youtube";
  return "search";
}

export function resolveTrackPlayButton(
  playback: PlaybackTarget,
  opts: { currentVideoId?: string | null; allowInteraction?: boolean },
): TrackPlayButtonModel {
  const url = (playback.url ?? "").trim();
  const allowInteraction = opts.allowInteraction !== false;
  const inactive = !allowInteraction || !url;

  const sourceType = inactive ? "search" : playbackToSourceType(playback);

  const embedId = youtubeVideoIdForInAppEmbed(playback);
  const isPlaying =
    !inactive &&
    Boolean(opts.currentVideoId && embedId && opts.currentVideoId === embedId);

  return {
    sourceType,
    isPlaying,
    disabled: inactive,
  };
}
