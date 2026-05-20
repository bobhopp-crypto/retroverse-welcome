import { pickCanonicalCoverForAlbum } from "@/lib/canonical-artwork-overrides";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

import { integrityQuery } from "./pg";
import type { GraphCoverLink } from "./types";

const RVAL_RE = /^RVAL[0-9]{6}$/i;

export async function getGraphCoverLinkForPgAlbum(pgAlbumId: number): Promise<GraphCoverLink | null> {
  const rows = await integrityQuery<{
    canonical_cover_path: string | null;
    local_cover_path: string | null;
    r2_cover_key: string | null;
    review_flag: string | null;
    source: string | null;
  }>(
    `
    SELECT
      aal.canonical_cover_path,
      aal.local_cover_path,
      aal.r2_cover_key,
      aal.review_flag,
      aal.source
    FROM album_artwork_links aal
    WHERE aal.album_id = $1
    ORDER BY (aal.review_flag IN ('curated', 'ok')) DESC, aal.confidence_score DESC NULLS LAST, aal.id
    LIMIT 1
    `,
    [pgAlbumId],
  );
  const row = rows[0];
  if (!row) {
    const albumRows = await integrityQuery<{ canonical_cover_path: string | null }>(
      `SELECT canonical_cover_path FROM albums WHERE id = $1`,
      [pgAlbumId],
    );
    const path = albumRows[0]?.canonical_cover_path?.trim() || null;
    return path
      ? { canonicalCoverPath: path, localCoverPath: null, r2CoverKey: null, reviewFlag: null, source: "albums" }
      : null;
  }
  return {
    canonicalCoverPath: row.canonical_cover_path,
    localCoverPath: row.local_cover_path,
    reviewFlag: row.review_flag,
    r2CoverKey: row.r2_cover_key,
    source: row.source,
  };
}

/**
 * Cover resolution priority:
 * 1. curated canonical_cover_path (overrides)
 * 2. album_artwork_links.r2_cover_key / canonical path from graph
 * 3. local/public path from graph link
 * 4. placeholder (null)
 */
export async function resolveAlbumCoverUrl(
  albumId: string,
  options?: { pgAlbumId?: number; cacheBust?: string | number | null },
): Promise<string | null> {
  const id = albumId.trim().toUpperCase();
  if (RVAL_RE.test(id)) {
    const picked = await pickCanonicalCoverForAlbum(id);
    if (picked.path?.trim()) {
      return canonicalCoverPathToUrl(picked.path, {
        cacheBust: picked.cacheBust,
      });
    }
  }

  const pgId = options?.pgAlbumId;
  if (pgId != null) {
    const link = await getGraphCoverLinkForPgAlbum(pgId);
    if (link?.canonicalCoverPath?.trim()) {
      return canonicalCoverPathToUrl(link.canonicalCoverPath, { cacheBust: options?.cacheBust });
    }
    if (link?.r2CoverKey?.trim()) {
      return canonicalCoverPathToUrl(link.r2CoverKey, { cacheBust: options?.cacheBust });
    }
    if (link?.localCoverPath?.trim()) {
      return canonicalCoverPathToUrl(link.localCoverPath, { cacheBust: options?.cacheBust });
    }
  }

  return null;
}
