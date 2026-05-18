import path from "node:path";

import { resolveLegacyPlayback } from "@/lib/legacy-playback/resolve";
import { loadLegacyVideoCache } from "@/lib/legacy-playback/video-cache";
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

function norm(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\bpt\.?\s*(i|1|one)\b/gi, " ")
    .replace(/\bfeat\.?\b.*$/gi, " ")
    .replace(/\bfeaturing\b.*$/gi, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

function artistTitlePairs(input: {
  chartArtist: string;
  chartTitle: string;
  vdjArtist?: string;
  vdjTitle?: string;
  vdjFilePath?: string;
}): Array<{ artist: string; title: string }> {
  const pairs: Array<{ artist: string; title: string }> = [];
  const seen = new Set<string>();

  const add = (artist: string, title: string) => {
    const a = artist.trim();
    const t = title.trim();
    if (!a || !t) return;
    const key = `${norm(a)}::${norm(t)}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ artist: a, title: t });
  };

  for (const title of titleVariants(input.chartTitle)) {
    add(input.chartArtist, title);
  }
  if (input.vdjArtist && input.vdjTitle) {
    for (const title of titleVariants(input.vdjTitle)) {
      add(input.vdjArtist, title);
    }
  }
  if (input.vdjFilePath) {
    const base = path.basename(input.vdjFilePath).replace(/\.[^.]+$/, "");
    const dash = base.indexOf(" - ");
    if (dash > 0) {
      const a = base.slice(0, dash).trim();
      const t = base.slice(dash + 3).trim();
      for (const title of titleVariants(t)) {
        add(a, title);
      }
    }
  }

  return pairs;
}

async function resolvePair(artist: string, title: string): Promise<{ local: string | null; other: string | null }> {
  try {
    const resolved = await resolveLegacyPlayback({ artist, title });
    const url = resolved.target.url?.trim() || resolved.merged.video_url?.trim() || null;
    if (!url) return { local: null, other: null };
    if (resolved.sourceType === "local") {
      return { local: url, other: isVideoStreamUrl(url) ? url : null };
    }
    return { local: null, other: isVideoStreamUrl(url) ? url : null };
  } catch {
    return { local: null, other: null };
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

async function fuzzyCacheLookup(chartArtist: string, chartTitle: string): Promise<string | null> {
  const { cache } = await loadLegacyVideoCache();
  const artistTokens = norm(chartArtist).split(" ").filter((t) => t.length > 2);
  const titleCore = norm(chartTitle.replace(/\([^)]*\)/g, ""));
  const titleTokens = titleCore.split(" ").filter((t) => t.length > 2);

  let bestUrl: string | null = null;
  let bestScore = 0;

  for (const [key, row] of Object.entries(cache)) {
    const nk = key.replace(/[^a-z0-9]+/g, " ");
    let score = 0;
    if (artistTokens.length > 0 && artistTokens.every((t) => nk.includes(t))) score += 12;
    const titleHits = titleTokens.filter((t) => nk.includes(t)).length;
    score += titleHits * 10;
    if (titleTokens.length >= 2 && titleHits >= Math.min(2, titleTokens.length)) score += 20;
    if (score < 22) continue;
    const url = urlFromCacheRow(row);
    if (!url) continue;
    const videoBonus = isVideoStreamUrl(url) ? 8 : 0;
    const total = score + videoBonus;
    if (total > bestScore) {
      bestScore = total;
      bestUrl = preferVideoUrl(bestUrl, url);
    }
  }

  return bestUrl;
}

/** Fuzzy R2 / playback check — missing is not authoritative. */
export async function checkPlaybackForFile(input: {
  chartArtist: string;
  chartTitle: string;
  vdjArtist?: string;
  vdjTitle?: string;
  vdjFilePath: string;
}): Promise<PlaybackCheck> {
  const pairs = artistTitlePairs(input);

  let localUrl: string | null = null;
  let possibleUrl: string | null = null;

  for (const pair of pairs) {
    const hit = await resolvePair(pair.artist, pair.title);
    if (hit.local) {
      localUrl = preferVideoUrl(localUrl, hit.local) ?? hit.local;
      if (isVideoStreamUrl(hit.local)) break;
    }
    if (hit.other) possibleUrl = preferVideoUrl(possibleUrl, hit.other);
  }

  if (!localUrl) {
    const fuzzy = await fuzzyCacheLookup(input.chartArtist, input.chartTitle);
    if (fuzzy) {
      if (fuzzy.startsWith("http")) {
        localUrl = fuzzy;
      } else if (!possibleUrl) {
        possibleUrl = fuzzy;
      }
    }
  }

  if (!localUrl && !possibleUrl) {
    const vdjStem = norm(path.basename(input.vdjFilePath).replace(/\.[^.]+$/, ""));
    const chartStem = `${norm(input.chartArtist)} ${norm(input.chartTitle)}`.trim();
    if (vdjStem.length > 8 && chartStem.length > 8) {
      const overlap = chartStem.split(" ").filter((t) => t.length > 2 && vdjStem.includes(t)).length;
      if (overlap >= 2) {
        const keyUrl = await fuzzyCacheLookup(input.chartArtist, input.chartTitle);
        if (keyUrl) possibleUrl = keyUrl;
      }
    }
  }

  const djVideo = isVideoExtension(input.vdjFilePath) && isDjVideoFolder(input.vdjFilePath);

  if (localUrl) return { status: "playable", playUrl: localUrl };
  if (possibleUrl) return { status: "possible", playUrl: possibleUrl };

  if (djVideo) {
    const drift = await fuzzyCacheLookup(input.chartArtist, input.chartTitle);
    if (drift) return { status: "possible", playUrl: drift };
    return { status: "possible", playUrl: null };
  }

  return { status: "not_found", playUrl: null };
}
