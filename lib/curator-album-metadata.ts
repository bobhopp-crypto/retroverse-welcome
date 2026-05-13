import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";

export type CuratorMetadataCheck = {
  ok: boolean;
  issues: string[];
};

/** Curator-specific: Discogs/API need real identity, not placeholders. */
export function validateAlbumRowForCurator(row: DiscoverStableAlbumRow): CuratorMetadataCheck {
  const issues: string[] = [];
  if (row.kind !== "album") {
    issues.push("row_not_album");
    return { ok: false, issues };
  }
  const aid = row.albumId?.trim?.() ?? "";
  if (!aid) issues.push("missing_album_id");

  const title = (row.title ?? "").trim();
  if (!title) issues.push("missing_title");

  const artist = (row.artist ?? "").trim();
  if (!artist) issues.push("missing_artist");

  /** DB join dropped or artist row missing — not safe for storefront/Discogs text match */
  if (artist === "Unknown artist") issues.push("unresolved_artist");

  return { ok: issues.length === 0, issues };
}
