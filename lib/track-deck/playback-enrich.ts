import { resolveLegacyPlayback } from "@/lib/legacy-playback/resolve";
import { chartTrackLinkKey, readTrackLinkIndex } from "@/lib/track-links";
import type { TrackDeckPlaybackSource, TrackDeckWeekPayload } from "./types";

function searchFallbackUrl(artist: string, title: string): string {
  const q = `${artist} ${title}`.trim() || "music";
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
}

export async function enrichTrackDeckWeekPlayback(
  payload: TrackDeckWeekPayload,
): Promise<TrackDeckWeekPayload> {
  const linkIndex = await readTrackLinkIndex();

  const tracks = await Promise.all(
    payload.tracks.map(async (t) => {
      const key = chartTrackLinkKey(t.artist, t.title);
      const saved = key ? linkIndex.get(key) : undefined;
      if (saved?.r2Url) {
        return {
          ...t,
          playbackSource: "local" as const,
          playableUrl: saved.r2Url,
        };
      }

      try {
        const resolved = await resolveLegacyPlayback({ artist: t.artist, title: t.title });
        return {
          ...t,
          playbackSource: resolved.sourceType as TrackDeckPlaybackSource,
          playableUrl: resolved.target.url,
        };
      } catch {
        return {
          ...t,
          playbackSource: "search" as const,
          playableUrl: searchFallbackUrl(t.artist, t.title),
        };
      }
    }),
  );
  return { ...payload, tracks };
}
