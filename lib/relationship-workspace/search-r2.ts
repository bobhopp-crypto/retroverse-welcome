import { resolveLegacyPlayback } from "@/lib/legacy-playback/resolve";
import { trackPlaybackKey } from "@/lib/legacy-playback/playback-key";

import { fuzzyScoreParts } from "./fuzzy";
import type { R2PanelEntry } from "./types";

/** Legacy video_lookup / playback resolver — not full R2 inventory. */
export async function searchR2MediaCandidates(input: {
  artist: string;
  title: string;
  rvtr?: string | null;
  topVdjPath?: string | null;
}): Promise<R2PanelEntry[]> {
  const entries: R2PanelEntry[] = [];

  try {
    const resolved = await resolveLegacyPlayback({
      artist: input.artist,
      title: input.title,
      rvtr: input.rvtr ?? undefined,
    });

    const mediaUrl =
      resolved.target.type === "video"
        ? resolved.target.url
        : resolved.target.type === "youtube"
          ? resolved.target.url
          : resolved.merged.video_url ?? null;

    const mediaKey = resolved.playbackKey || trackPlaybackKey(input.artist, input.title);
    const playable = resolved.sourceType === "local" || resolved.sourceType === "youtube";
    const matchedBy = resolved.cacheHit
      ? `video_lookup key · ${mediaKey}`
      : `resolver · ${resolved.sourceType}`;

    const vdjNorm = input.topVdjPath?.toLowerCase() ?? "";
    const urlNorm = (mediaUrl ?? "").toLowerCase();
    let vdjPathMatch: boolean | null = null;
    if (vdjNorm && urlNorm) {
      const base = vdjNorm.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
      vdjPathMatch = base.length > 4 && urlNorm.includes(base.slice(0, 12));
    }

    const { score } = fuzzyScoreParts(
      `${input.artist} ${input.title} ${mediaUrl ?? ""}`,
      input.artist,
      input.title,
    );

    entries.push({
      mediaUrl,
      mediaKey,
      playable,
      sourceType: resolved.sourceType,
      matchedBy,
      score: resolved.cacheHit ? Math.max(score, 70) : score,
      vdjPathMatch,
    });
  } catch {
    entries.push({
      mediaUrl: null,
      mediaKey: trackPlaybackKey(input.artist, input.title),
      playable: false,
      sourceType: "search",
      matchedBy: "no legacy cache hit",
      score: 0,
      vdjPathMatch: null,
    });
  }

  return entries;
}
