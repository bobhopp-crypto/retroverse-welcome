import path from "node:path";

import { trackPlaybackKey } from "@/lib/legacy-playback/playback-key";
import { resolveLegacyPlayback } from "@/lib/legacy-playback/resolve";
import { loadLegacyVideoCache } from "@/lib/legacy-playback/video-cache";

import { artistMatchesChart, fuzzyScoreParts, tokenize } from "./fuzzy";
import {
  isDjVideoFolder,
  isVideoExtension,
  isVideoStreamUrl,
  preferVideoUrl,
} from "./vdj-media";

export type PlaybackStatus = "playable" | "possible" | "not_found";

export type PlaybackCheck = {
  status: PlaybackStatus;
  playUrl: string | null;
};

function titleVariants(title: string): string[] {
  const out = new Set<string>();
  const t = title.trim();
  if (t) out.add(t);
  const noParen = t.replace(/\([^)]*\)/g, "").trim();
  if (noParen) out.add(noParen);
  const noPt = noParen.replace(/\bpt\.?\s*(i|1|one)\b/gi, "").trim();
  if (noPt) out.add(noPt);
  return [...out].filter(Boolean);
}

async function resolveExactChartPair(
  artist: string,
  title: string,
): Promise<{ local: string | null; stream: string | null }> {
  try {
    const resolved = await resolveLegacyPlayback({ artist, title });
    const url = resolved.target.url?.trim() || resolved.merged.video_url?.trim() || null;
    if (!url) return { local: null, stream: null };
    if (resolved.sourceType === "local") {
      return {
        local: url,
        stream: isVideoStreamUrl(url) ? url : null,
      };
    }
    return { local: null, stream: isVideoStreamUrl(url) ? url : null };
  } catch {
    return { local: null, stream: null };
  }
}

function urlFromCacheRow(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const o = row as Record<string, unknown>;
  const url =
    (typeof o.video_url === "string" && o.video_url) ||
    (typeof o.r2_url === "string" && o.r2_url) ||
    (typeof o.url === "string" && o.url) ||
    null;
  return url?.trim() || null;
}

/** R2 cache lookup scoped to chart artist — never cross-match unrelated artists. */
async function scopedCacheLookup(chartArtist: string, chartTitle: string): Promise<string | null> {
  const { cache } = await loadLegacyVideoCache();
  const artistTokens = tokenize(chartArtist).filter((t) => t.length > 2);
  const titleTokens = tokenize(chartTitle.replace(/\([^)]*\)/g, ""));

  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const [key, row] of Object.entries(cache)) {
    const nk = key.replace(/[^a-z0-9]+/g, " ");
    if (artistTokens.length > 0 && !artistTokens.every((t) => nk.includes(t))) continue;

    let score = 0;
    const titleHits = titleTokens.filter((t) => nk.includes(t)).length;
    score += titleHits * 12;
    if (titleTokens.length >= 2 && titleHits >= Math.min(2, titleTokens.length)) score += 24;

    const exactKey = trackPlaybackKey(chartArtist, chartTitle);
    if (exactKey && (key === exactKey || nk.includes(exactKey.replace(/__/g, " ")))) {
      score += 80;
    }

    if (score < 22) continue;
    const url = urlFromCacheRow(row);
    if (!url) continue;
    const total = score + (isVideoStreamUrl(url) ? 8 : 0);
    if (total > bestScore) {
      bestScore = total;
      bestUrl = preferVideoUrl(bestUrl, url);
    }
  }

  return bestUrl;
}

function fileTitleOverlapScore(
  chartArtist: string,
  chartTitle: string,
  vdjFilePath: string,
): number {
  const hay = path.basename(vdjFilePath).replace(/\.[^.]+$/, "");
  return fuzzyScoreParts(hay, chartArtist, chartTitle).score;
}

/**
 * Playback for a user-selected VDJ file — chart artist is authoritative.
 * PLAYABLE only on exact chart artist+title R2/local resolve; never global fuzzy drift.
 */
export async function checkPlaybackForFile(input: {
  chartArtist: string;
  chartTitle: string;
  vdjArtist?: string;
  vdjTitle?: string;
  vdjFilePath: string;
}): Promise<PlaybackCheck> {
  if (
    input.vdjArtist &&
    !artistMatchesChart(input.chartArtist, {
      artist: input.vdjArtist,
      filePath: input.vdjFilePath,
    })
  ) {
    return { status: "not_found", playUrl: null };
  }

  let exactUrl: string | null = null;
  for (const title of titleVariants(input.chartTitle)) {
    const hit = await resolveExactChartPair(input.chartArtist, title);
    if (hit.stream) {
      exactUrl = hit.stream;
      break;
    }
    if (hit.local) exactUrl = preferVideoUrl(exactUrl, hit.local) ?? hit.local;
  }

  if (exactUrl) {
    return { status: "playable", playUrl: exactUrl };
  }

  const djVideo = isVideoExtension(input.vdjFilePath) && isDjVideoFolder(input.vdjFilePath);
  const overlap = fileTitleOverlapScore(input.chartArtist, input.chartTitle, input.vdjFilePath);
  const scopedUrl = await scopedCacheLookup(input.chartArtist, input.chartTitle);

  if (scopedUrl && overlap >= 28) {
    return { status: "possible", playUrl: scopedUrl };
  }

  if (djVideo && overlap >= 22) {
    return { status: "possible", playUrl: null };
  }

  if (scopedUrl && overlap >= 18) {
    return { status: "possible", playUrl: scopedUrl };
  }

  return { status: "not_found", playUrl: null };
}
