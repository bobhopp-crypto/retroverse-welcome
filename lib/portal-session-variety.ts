import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";

const SESSION_KEY = "retroverse-portal-viewed-albums-v1";
const MAX_STORED_IDS = 1200;

function trustTier(row: DiscoverStableAlbumRow | undefined): number {
  if (!row || row.kind !== "album") return 2;
  if (!row.canonicalCoverPath?.trim()) return 2;
  if (row.trustState === "verified") return 0;
  return 1;
}

/** Prefer unseen, then verified cover / has art / id for stable variety. */
export function orderPortalAlbumIds(
  canonicalIds: string[],
  viewed: Set<string>,
  cache: ReadonlyMap<string, DiscoverStableAlbumRow>,
): string[] {
  const unseen = canonicalIds.filter((id) => !viewed.has(id));
  const seen = canonicalIds.filter((id) => viewed.has(id));
  const byRank = (a: string, b: string) =>
    trustTier(cache.get(a)) - trustTier(cache.get(b)) || a.localeCompare(b);
  const unseenSorted = [...unseen].sort(byRank);
  const seenSorted = [...seen].sort((a, b) => a.localeCompare(b));
  return [...unseenSorted, ...seenSorted];
}

export function loadPortalViewedAlbums(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is string => typeof x === "string" && x.length > 0));
  } catch {
    return new Set();
  }
}

export function recordPortalAlbumViewed(albumId: string): void {
  if (typeof window === "undefined") return;
  const id = albumId.trim().toUpperCase();
  if (!id) return;
  const next = loadPortalViewedAlbums();
  if (next.has(id)) return;
  next.add(id);
  const arr = [...next];
  const tail = arr.slice(-MAX_STORED_IDS);
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(tail));
}

export function firstUnseenAlbumIndex(ids: string[], viewed: Set<string>): number {
  const idx = ids.findIndex((id) => !viewed.has(id));
  return idx >= 0 ? idx : 0;
}

/**
 * Step index in direction, skipping seen ids when possible so browsing favors discovery.
 */
export function nextPortalAlbumIndexPreferUnseen(
  ids: string[],
  fromIndex: number,
  direction: -1 | 1,
  viewed: Set<string>,
): number {
  const len = ids.length;
  if (len <= 0) return 0;
  const d = direction > 0 ? 1 : -1;
  let j = fromIndex + d;
  while (j >= 0 && j < len) {
    if (!viewed.has(ids[j]!)) return j;
    j += d;
  }
  return Math.min(len - 1, Math.max(0, fromIndex + d));
}
