import { trackPlaybackKey } from "./playback-key";

let playCountMap: Record<string, number> = {};

export function setPlayCountMapFromVideoIndexItems(items: Record<string, unknown>[]): void {
  const m: Record<string, number> = {};
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const artist = String(item["artist"] ?? item["author"] ?? "").trim();
    const title = String(item["title"] ?? "").trim();
    if (!artist || !title) continue;
    const k = trackPlaybackKey(artist, title);
    if (!k) continue;
    const rb = item["retentionBreakdown"] as { xmlLifetimePlaycount?: number } | undefined;
    const rbs = item["retention_breakdown"] as {
      xmlLifetimePlaycount?: number;
      xml_lifetime_playcount?: number;
    } | undefined;
    const raw =
      rb?.xmlLifetimePlaycount ??
      rbs?.xmlLifetimePlaycount ??
      rbs?.xml_lifetime_playcount ??
      item["play_count"] ??
      item["playCount"] ??
      0;
    const n = typeof raw === "number" && !Number.isNaN(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    m[k] = Math.max(m[k] ?? 0, n);
  }
  playCountMap = m;
}

export function getPlayCountForKey(key: string): number {
  if (!key) return 0;
  return playCountMap[key] ?? 0;
}
