import {
  getPlaybackSourceBundle,
  mergeVideoCache,
  playbackTargetFromSourceBundle,
  type PlaybackTarget,
  type PlaybackTrackInput,
  type VideoCacheDict,
} from "@/lib/legacy-playback/playback";

/** Center play icon state only — independent from sonic rings. */
export type TrackPlayState =
  | "vdj_video"
  | "vdj_audio"
  | "youtube_verified"
  | "youtube_search"
  | "no_media";

export const TRACK_PLAY_TRIANGLE_COLOR: Record<TrackPlayState, string> = {
  vdj_video: "rgb(232, 107, 79)",
  vdj_audio: "rgb(255, 200, 120)",
  youtube_verified: "rgb(199, 107, 143)",
  youtube_search: "rgb(94, 196, 207)",
  no_media: "rgb(188, 178, 168)",
};

export type TrackPlayResolution = {
  state: TrackPlayState;
  playbackUrl: string | null;
  mediaLabel: string;
};

export type TrackMediaSlot = Exclude<TrackPlayState, "no_media">;

export type TrackMediaAvailability = Record<TrackMediaSlot, boolean>;

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|opus)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|webm|mkv|m4v|avi)(\?|#|$)/i;

function classifyLocalUrl(url: string): "video" | "audio" | "unknown" {
  const u = url.trim().toLowerCase();
  if (AUDIO_EXT.test(u)) return "audio";
  if (VIDEO_EXT.test(u)) return "video";
  return "unknown";
}

function mediaLabelForState(state: TrackPlayState): string {
  switch (state) {
    case "vdj_video":
      return "VDJ video";
    case "vdj_audio":
      return "VDJ audio";
    case "youtube_verified":
      return "YouTube verified";
    case "youtube_search":
      return "YouTube search";
    default:
      return "No media";
  }
}

function resolvePlayStateFromTarget(
  target: PlaybackTarget,
  merged: PlaybackTrackInput,
  bundleHasYoutube: boolean,
): TrackPlayState {
  if (target.type === "video") {
    const url = (target.url ?? "").trim();
    const kind = url ? classifyLocalUrl(url) : "unknown";
    if (kind === "audio") return "vdj_audio";
    return "vdj_video";
  }
  if (target.type === "youtube") return "youtube_verified";
  if (target.type === "search") {
    const plays =
      typeof merged.play_count === "number" && Number.isFinite(merged.play_count)
        ? merged.play_count
        : 0;
    const hasLocal = Boolean(merged.video_url?.trim() || merged.local_path?.trim());
    if (plays > 0 && !hasLocal && !bundleHasYoutube) return "vdj_audio";
    const url = (target.url ?? "").trim();
    if (!url) return "no_media";
    return "youtube_search";
  }
  return "no_media";
}

function trackMediaInputs(artist: string, title: string, videoCache?: VideoCacheDict) {
  const ar = artist.trim();
  const ti = title.trim();
  const trackInput: PlaybackTrackInput = { artist: ar, title: ti };
  const merged = mergeVideoCache(trackInput, videoCache);
  const bundle = getPlaybackSourceBundle(merged);
  return { ar, ti, merged, bundle };
}

/** Which source lanes exist for this track (strip indicators only). */
export function resolveTrackMediaAvailability(
  artist: string,
  title: string,
  videoCache?: VideoCacheDict,
): TrackMediaAvailability {
  const { ar, ti, merged, bundle } = trackMediaInputs(artist, title, videoCache);
  if (!ar || !ti) {
    return {
      vdj_video: false,
      vdj_audio: false,
      youtube_verified: false,
      youtube_search: false,
    };
  }

  const localUrl = (merged.video_url ?? merged.local_path ?? "").trim();
  const localKind = localUrl ? classifyLocalUrl(localUrl) : "unknown";
  const hasLocalVideo = localKind === "video" || (localKind === "unknown" && Boolean(localUrl));
  const plays =
    typeof merged.play_count === "number" && Number.isFinite(merged.play_count) ? merged.play_count : 0;
  const hasLocalAudio = localKind === "audio" || (plays > 0 && !hasLocalVideo);
  const hasYoutube = Boolean(bundle.sources.youtube?.videoId);
  const searchReady =
    bundle.fallback.type === "search" ? Boolean((bundle.fallback.url ?? "").trim()) : false;

  return {
    vdj_video: hasLocalVideo,
    vdj_audio: hasLocalAudio,
    youtube_verified: hasYoutube,
    youtube_search: searchReady || hasYoutube,
  };
}

export function resolveTrackPlayState(
  artist: string,
  title: string,
  videoCache?: VideoCacheDict,
): TrackPlayResolution {
  const ar = artist.trim();
  const ti = title.trim();
  if (!ar || !ti) {
    return { state: "no_media", playbackUrl: null, mediaLabel: mediaLabelForState("no_media") };
  }

  const { merged, bundle } = trackMediaInputs(artist, title, videoCache);
  const target = playbackTargetFromSourceBundle(bundle);
  const bundleHasYoutube = Boolean(bundle.sources.youtube?.videoId);
  const state = resolvePlayStateFromTarget(target, merged, bundleHasYoutube);
  const playbackUrl = state === "no_media" ? null : (target.url ?? "").trim() || null;

  return {
    state,
    playbackUrl,
    mediaLabel: mediaLabelForState(state),
  };
}
