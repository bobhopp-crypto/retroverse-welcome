/** Browser-only Discover memory (per device). Caps enforced on write. */

export const DISCOVER_CLIENT_MEMORY_KEY = "retroverse_discover_memory_v1";

const MAX_SEEN = 2000;
const MAX_HIDDEN = 1000;
const MAX_SNOOZE = 200;
const SNOOZE_MS = 86_400_000; // 24h

export type DiscoverClientMemoryV1 = {
  v: 1;
  seenAlbumIds: string[];
  hiddenAlbumIds: string[];
  /** Hide-for-now: excluded until `until` (epoch ms). */
  snoozed: Array<{ id: string; until: number }>;
};

function emptyMemory(): DiscoverClientMemoryV1 {
  return { v: 1, seenAlbumIds: [], hiddenAlbumIds: [], snoozed: [] };
}

function capTail<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  return arr.slice(arr.length - max);
}

function pruneSnoozed(now: number, snoozed: Array<{ id: string; until: number }>): Array<{ id: string; until: number }> {
  const alive = snoozed.filter((s) => s.until > now);
  return alive.slice(Math.max(0, alive.length - MAX_SNOOZE));
}

export function readDiscoverClientMemory(): DiscoverClientMemoryV1 {
  if (typeof window === "undefined") return emptyMemory();
  try {
    const raw = window.localStorage.getItem(DISCOVER_CLIENT_MEMORY_KEY);
    if (!raw) return emptyMemory();
    const parsed = JSON.parse(raw) as DiscoverClientMemoryV1;
    if (!parsed || parsed.v !== 1) return emptyMemory();
    const now = Date.now();
    const snoozed = pruneSnoozed(now, Array.isArray(parsed.snoozed) ? parsed.snoozed : []);
    return {
      v: 1,
      seenAlbumIds: capTail(Array.isArray(parsed.seenAlbumIds) ? parsed.seenAlbumIds.filter(Boolean) : [], MAX_SEEN),
      hiddenAlbumIds: capTail(Array.isArray(parsed.hiddenAlbumIds) ? parsed.hiddenAlbumIds.filter(Boolean) : [], MAX_HIDDEN),
      snoozed,
    };
  } catch {
    return emptyMemory();
  }
}

export function writeDiscoverClientMemory(m: DiscoverClientMemoryV1): void {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const body: DiscoverClientMemoryV1 = {
    v: 1,
    seenAlbumIds: capTail(m.seenAlbumIds.filter(Boolean), MAX_SEEN),
    hiddenAlbumIds: capTail(m.hiddenAlbumIds.filter(Boolean), MAX_HIDDEN),
    snoozed: pruneSnoozed(now, m.snoozed).slice(-MAX_SNOOZE),
  };
  window.localStorage.setItem(DISCOVER_CLIENT_MEMORY_KEY, JSON.stringify(body));
}

export function discoverMemorySeenSet(mem: DiscoverClientMemoryV1): Set<string> {
  return new Set(mem.seenAlbumIds);
}

export function discoverMemoryHiddenSet(mem: DiscoverClientMemoryV1): Set<string> {
  return new Set(mem.hiddenAlbumIds);
}

export function discoverMemorySnoozedSet(mem: DiscoverClientMemoryV1): Set<string> {
  const now = Date.now();
  return new Set(mem.snoozed.filter((s) => s.until > now).map((s) => s.id));
}

export function appendDiscoverSeenAlbumId(albumId: string): DiscoverClientMemoryV1 {
  const cur = readDiscoverClientMemory();
  const next = cur.seenAlbumIds.filter((id) => id !== albumId);
  next.push(albumId);
  const out = { ...cur, seenAlbumIds: capTail(next, MAX_SEEN) };
  writeDiscoverClientMemory(out);
  return out;
}

export function appendDiscoverHiddenAlbumId(albumId: string): DiscoverClientMemoryV1 {
  const cur = readDiscoverClientMemory();
  const hidden = capTail([...cur.hiddenAlbumIds.filter((id) => id !== albumId), albumId], MAX_HIDDEN);
  const out = {
    ...cur,
    hiddenAlbumIds: hidden,
    snoozed: cur.snoozed.filter((s) => s.id !== albumId),
  };
  writeDiscoverClientMemory(out);
  return out;
}

export function snoozeDiscoverAlbumId(albumId: string): DiscoverClientMemoryV1 {
  const cur = readDiscoverClientMemory();
  const until = Date.now() + SNOOZE_MS;
  const rest = cur.snoozed.filter((s) => s.id !== albumId);
  const snoozed = [...rest, { id: albumId, until }].slice(-MAX_SNOOZE);
  const out = { ...cur, snoozed };
  writeDiscoverClientMemory(out);
  return out;
}
