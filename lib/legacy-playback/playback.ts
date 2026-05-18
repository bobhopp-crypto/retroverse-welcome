import { getPlayCountForKey } from "./vdj-play-count-map";
import { normalizeKeyPart, trackPlaybackKey } from "./playback-key";

export { normalizeKeyPart, trackPlaybackKey } from "./playback-key";

export type PlaybackTargetType = "video" | "youtube" | "search";

export type PlaybackTarget = {
  type: PlaybackTargetType;
  url: string;
};

export type PlaybackSourceBundle = {
  sources: {
    r2?: { url: string };
    youtube?: { videoId: string };
  };
  preferred: "r2" | "youtube";
  fallback: PlaybackTarget;
};

export type VideoCacheDict = Record<
  string,
  {
    youtube_id?: string;
    video_url?: string;
    local_path?: string;
    thumbnail?: string;
    play_count?: number;
  }
>;

export type PlaybackTrackInput = {
  title?: string;
  name?: string;
  artist?: string;
  video_url?: string | null;
  local_path?: string | null;
  youtube_id?: string | null;
  search_query?: string | null;
  thumbnail?: string | null;
  play_count?: number;
};

export function normalizePlaybackTrack(track: PlaybackTrackInput): PlaybackTrackInput {
  return {
    ...track,
    title: track.title?.trim() || undefined,
    name: track.name?.trim() || undefined,
    artist: track.artist?.trim() || undefined,
    video_url: track.video_url?.trim() || undefined,
    youtube_id: track.youtube_id?.trim() || undefined,
    local_path: track.local_path?.trim() || undefined,
    search_query: track.search_query?.trim() || undefined,
    thumbnail: track.thumbnail?.trim() || undefined,
    play_count:
      typeof track.play_count === "number" && Number.isFinite(track.play_count)
        ? track.play_count
        : undefined,
  };
}

function vdjPlaysForKeys(artist: string, title: string, primaryKey: string): number {
  const keys: string[] = [primaryKey];
  const ar = artist;
  const normTitle = normalizeKeyPart(title);
  const compactTitle = normTitle.replace(/\s+/g, "");
  if (compactTitle !== normTitle) {
    const alt = trackPlaybackKey(ar, compactTitle);
    if (alt && alt !== primaryKey) keys.push(alt);
  }
  const compactArtist = normalizeKeyPart(ar).replace(/\s+/g, "");
  const compactTit = normTitle.replace(/\s+/g, "");
  if (compactArtist && compactTit) {
    const sk = trackPlaybackKey(compactArtist, compactTit);
    if (sk && !keys.includes(sk)) keys.push(sk);
  }
  return Math.max(0, ...keys.map((k) => getPlayCountForKey(k)));
}

function trackPlayCountT(t: PlaybackTrackInput): number {
  if (typeof t.play_count === "number" && Number.isFinite(t.play_count)) {
    return Math.max(0, t.play_count);
  }
  return 0;
}

export function mergeVideoCache(
  track: PlaybackTrackInput,
  videoCache: VideoCacheDict | undefined,
): PlaybackTrackInput {
  const t = normalizePlaybackTrack(track);
  const title = t.title ?? t.name ?? "";
  const ar = t.artist ?? "";
  const key = trackPlaybackKey(ar, title);
  const tPc = trackPlayCountT(t);
  if (!key) {
    return { ...t, play_count: tPc };
  }
  const vdj = vdjPlaysForKeys(ar, title, key);

  if (!videoCache || Object.keys(videoCache).length === 0) {
    return { ...t, play_count: Math.max(tPc, vdj) };
  }

  let row = videoCache[key];
  if (!row || typeof row !== "object") {
    const normTitle = normalizeKeyPart(title);
    const compactTitle = normTitle.replace(/\s+/g, "");
    if (compactTitle !== normTitle) {
      const alt = trackPlaybackKey(ar, compactTitle);
      if (alt && alt !== key) {
        row = videoCache[alt];
      }
    }
  }
  if (!row || typeof row !== "object") {
    const compactArtist = normalizeKeyPart(ar).replace(/\s+/g, "");
    const compactTit = normalizeKeyPart(title).replace(/\s+/g, "");
    if (compactArtist && compactTit) {
      const slugKey = trackPlaybackKey(compactArtist, compactTit);
      if (slugKey && slugKey !== key) {
        row = videoCache[slugKey];
      }
    }
  }
  const r = row as VideoCacheDict[string] | undefined;
  const fromRow =
    r && typeof r.play_count === "number" && Number.isFinite(r.play_count) ? r.play_count : 0;
  const play_count = Math.max(tPc, vdj, fromRow);

  if (!r || typeof r !== "object") {
    return { ...t, play_count };
  }
  return {
    ...t,
    youtube_id: t.youtube_id || r.youtube_id || undefined,
    video_url: t.video_url || r.video_url || undefined,
    local_path: t.local_path || r.local_path || undefined,
    thumbnail: t.thumbnail || r.thumbnail || undefined,
    play_count,
  };
}

export function resolveTrackPlayback(
  track: PlaybackTrackInput,
  videoCache?: VideoCacheDict,
): PlaybackTarget {
  return playbackTargetFromSourceBundle(getPlaybackSourceBundle(mergeVideoCache(track, videoCache)));
}

export function normalizePlaybackOpenUrl(url: string): string {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.hostname === "www.youtube-nocookie.com" || u.hostname === "youtube-nocookie.com") {
      u.hostname = "www.youtube.com";
    }
    return u.toString();
  } catch {
    return url;
  }
}

export function youtubeVideoIdForInAppEmbed(playback: PlaybackTarget): string | null {
  const url = normalizePlaybackOpenUrl(playback.url);
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "");
    if (h === "youtube.com" || h === "m.youtube.com" || h === "music.youtube.com") {
      const v = u.searchParams.get("v");
      if (v) return v;
    }
    if (h === "youtu.be") {
      const seg = u.pathname.split("/").filter(Boolean)[0];
      if (seg) return seg;
    }
  } catch {
    return null;
  }
  return null;
}

function buildSearchFallback(track: PlaybackTrackInput): PlaybackTarget {
  const title = (track.title ?? track.name ?? "").trim();
  const artist = (track.artist ?? "").trim();
  const q = track.search_query?.trim() || `${artist} ${title}`.trim() || "music";
  return {
    type: "search",
    url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
  };
}

export function getPlaybackSourceBundle(track: PlaybackTrackInput): PlaybackSourceBundle {
  const sources: PlaybackSourceBundle["sources"] = {};
  const directVideo = track.video_url?.trim() || track.local_path?.trim();
  if (directVideo) {
    sources.r2 = { url: normalizePlaybackOpenUrl(directVideo) };
  }
  const yt = track.youtube_id?.trim();
  if (yt) {
    sources.youtube = { videoId: yt };
  }
  return {
    sources,
    preferred: "r2",
    fallback: buildSearchFallback(track),
  };
}

export function playbackTargetFromSourceBundle(bundle: PlaybackSourceBundle): PlaybackTarget {
  const { sources, preferred, fallback } = bundle;
  const ytBlock = (id: string) => ({
    type: "youtube" as const,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`,
  });
  if (preferred === "r2") {
    if (sources.r2?.url) return { type: "video", url: sources.r2.url };
    if (sources.youtube?.videoId) return ytBlock(sources.youtube.videoId);
    return fallback;
  }
  if (preferred === "youtube") {
    if (sources.youtube?.videoId) return ytBlock(sources.youtube.videoId);
    if (sources.r2?.url) return { type: "video", url: sources.r2.url };
    return fallback;
  }
  return fallback;
}
