import { readFile, stat } from "node:fs/promises";

import {
  DEFAULT_VIDEO_CACHE_PATH,
  DEFAULT_VIDEO_LOOKUP_PATH,
} from "./constants";
import type { VideoCacheDict } from "./playback";
import { setPlayCountMapFromVideoIndexItems } from "./vdj-play-count-map";

/** Convert charts_app `video_lookup.json` (`titleSlug|artistSlug`) → `artistSlug__titleSlug`. */
export function videoLookupToVideoCache(raw: Record<string, unknown>): VideoCacheDict {
  const out: VideoCacheDict = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!k.includes("|") || !v || typeof v !== "object" || Array.isArray(v)) continue;
    const parts = k.split("|");
    if (parts.length !== 2) continue;
    const titleSlug = parts[0]?.trim().toLowerCase();
    const artistSlug = parts[1]?.trim().toLowerCase();
    if (!titleSlug || !artistSlug) continue;
    const row = v as {
      r2_url?: string;
      file_path?: string;
      url?: string;
      thumbnail?: string;
      thumb?: string;
      poster?: string;
      image?: string;
      play_count?: number;
      playCount?: number;
    };
    const url = row.r2_url?.trim() || row.file_path?.trim() || row.url?.trim();
    if (!url) continue;
    const thumb =
      row.thumbnail?.trim() || row.thumb?.trim() || row.poster?.trim() || row.image?.trim() || null;
    const pc = row.play_count ?? row.playCount;
    const play_count = typeof pc === "number" && Number.isFinite(pc) ? Math.trunc(pc) : undefined;
    const playbackKey = `${artistSlug}__${titleSlug}`;
    out[playbackKey] = {
      ...(url.startsWith("http") ? { video_url: url } : { local_path: url, video_url: url }),
      ...(thumb ? { thumbnail: thumb } : {}),
      ...(play_count !== undefined ? { play_count } : {}),
    };
  }
  return out;
}

function normalizeDiskPayload(data: Record<string, unknown>): VideoCacheDict {
  const keys = Object.keys(data);
  const first = keys[0];
  if (first && first.includes("|")) {
    return videoLookupToVideoCache(data);
  }
  return data as VideoCacheDict;
}

async function fileExists(absolute: string): Promise<boolean> {
  try {
    const s = await stat(absolute);
    return s.isFile();
  } catch {
    return false;
  }
}

async function loadJsonFile(filePath: string): Promise<VideoCacheDict | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (data && typeof data === "object" && !Array.isArray(data)) {
      const cache = normalizeDiskPayload(data as Record<string, unknown>);
      if (Object.keys(cache).length > 0) return cache;
    }
  } catch {
    /* missing */
  }
  return null;
}

async function loadOptionalVideoIndex(): Promise<void> {
  const indexPath = process.env.LEGACY_VIDEO_INDEX_PATH?.trim();
  if (!indexPath || !(await fileExists(indexPath))) return;
  try {
    const raw = await readFile(indexPath, "utf8");
    const data = JSON.parse(raw) as unknown;
    if (Array.isArray(data)) {
      setPlayCountMapFromVideoIndexItems(data as Record<string, unknown>[]);
    }
  } catch {
    /* optional */
  }
}

let loadOnce: Promise<{
  cache: VideoCacheDict;
  loadedFrom: string | null;
  entryCount: number;
}> | null = null;

/**
 * Loads legacy R2 lookup (video_lookup.json) once per process.
 * Optional VDJ play counts via LEGACY_VIDEO_INDEX_PATH.
 */
export function loadLegacyVideoCache(): Promise<{
  cache: VideoCacheDict;
  loadedFrom: string | null;
  entryCount: number;
}> {
  if (!loadOnce) {
    loadOnce = (async () => {
      const candidates = [
        process.env.LEGACY_VIDEO_LOOKUP_PATH?.trim() || DEFAULT_VIDEO_LOOKUP_PATH,
        DEFAULT_VIDEO_CACHE_PATH,
      ];
      let cache: VideoCacheDict = {};
      let loadedFrom: string | null = null;
      for (const filePath of candidates) {
        if (!(await fileExists(filePath))) continue;
        const parsed = await loadJsonFile(filePath);
        if (parsed) {
          cache = parsed;
          loadedFrom = filePath;
          break;
        }
      }
      await loadOptionalVideoIndex();
      return { cache, loadedFrom, entryCount: Object.keys(cache).length };
    })();
  }
  return loadOnce;
}
