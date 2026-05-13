/**
 * Resolve a `retroverse_album_id` from a chart appearance row.
 * Prefer direct `retroverse_album_id` on the appearance (Billboard 200 album anchoring),
 * else fall back to the joined `retroverse_tracks.retroverse_album_id` (singles / track charts).
 */
export type ChartAppearanceAlbumProjection = {
  retroverse_album_id?: string | null;
  retroverse_tracks?:
    | { retroverse_album_id?: string | null }
    | Array<{ retroverse_album_id?: string | null }>
    | null;
};

export function albumIdFromChartAppearanceRow(row: ChartAppearanceAlbumProjection): string | null {
  const direct = typeof row.retroverse_album_id === "string" ? row.retroverse_album_id.trim() : "";
  if (direct) return direct.toUpperCase();
  const raw = row.retroverse_tracks;
  if (!raw) return null;
  const link = Array.isArray(raw) ? raw[0] : raw;
  const id = link?.retroverse_album_id?.trim();
  return id ? id.toUpperCase() : null;
}
