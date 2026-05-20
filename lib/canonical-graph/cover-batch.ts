import {
  getCanonicalArtworkOverrides,
  resolveLocalFirstCanonicalCover,
} from "@/lib/canonical-artwork-overrides";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

import { integrityQuery } from "./pg";
import type { GraphCoverLink } from "./types";
import type { GraphYearAlbum } from "./types";

export type YearAlbumWithCover = GraphYearAlbum & {
  coverUrl: string | null;
};

function pathFromLink(link: GraphCoverLink | undefined): string | null {
  if (!link) return null;
  return link.canonicalCoverPath?.trim() || link.r2CoverKey?.trim() || link.localCoverPath?.trim() || null;
}

async function batchArtworkLinks(pgAlbumIds: number[]): Promise<Map<number, GraphCoverLink>> {
  if (pgAlbumIds.length === 0) return new Map();
  const rows = await integrityQuery<{
    album_id: number;
    canonical_cover_path: string | null;
    local_cover_path: string | null;
    r2_cover_key: string | null;
    review_flag: string | null;
    source: string | null;
  }>(
    `
    SELECT DISTINCT ON (aal.album_id)
      aal.album_id,
      aal.canonical_cover_path,
      aal.local_cover_path,
      aal.r2_cover_key,
      aal.review_flag,
      aal.source
    FROM album_artwork_links aal
    WHERE aal.album_id = ANY($1::bigint[])
    ORDER BY aal.album_id, (aal.review_flag IN ('curated', 'ok')) DESC, aal.confidence_score DESC NULLS LAST
    `,
    [pgAlbumIds],
  );
  const out = new Map<number, GraphCoverLink>();
  for (const row of rows) {
    out.set(row.album_id, {
      canonicalCoverPath: row.canonical_cover_path,
      localCoverPath: row.local_cover_path,
      r2CoverKey: row.r2_cover_key,
      reviewFlag: row.review_flag,
      source: row.source,
    });
  }
  const missing = pgAlbumIds.filter((id) => !out.has(id));
  if (missing.length === 0) return out;
  const albumRows = await integrityQuery<{ id: number; canonical_cover_path: string | null }>(
    `SELECT id, canonical_cover_path FROM albums WHERE id = ANY($1::bigint[]) AND coalesce(canonical_cover_path, '') <> ''`,
    [missing],
  );
  for (const row of albumRows) {
    out.set(row.id, {
      canonicalCoverPath: row.canonical_cover_path,
      localCoverPath: null,
      r2CoverKey: null,
      reviewFlag: null,
      source: "albums",
    });
  }
  return out;
}

/** One overrides read + one artwork query for an entire year grid. */
export async function attachCoverUrlsToYearAlbums(rows: GraphYearAlbum[]): Promise<YearAlbumWithCover[]> {
  if (rows.length === 0) return [];
  const overrides = await getCanonicalArtworkOverrides();
  const artworkMap = await batchArtworkLinks(rows.map((r) => r.pgAlbumId));

  return rows.map((row) => {
    const local = resolveLocalFirstCanonicalCover(row.albumId, overrides, null);
    const path =
      local.path?.trim() ||
      pathFromLink(artworkMap.get(row.pgAlbumId)) ||
      null;
    const coverUrl = path ? canonicalCoverPathToUrl(path, { cacheBust: local.cacheBust }) : null;
    return { ...row, coverUrl };
  });
}
