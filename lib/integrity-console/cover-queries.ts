import { getCoverSummary } from "@/lib/canonical-graph";
import { integrityQuery } from "./pg";
import type { ExplorerData, IntegrityView } from "./types";

export type CoverLinkRow = {
  albumId: number;
  artistName: string;
  albumTitle: string;
  canonicalCoverPath: string | null;
  r2CoverKey: string | null;
  reviewFlag: string;
  source: string;
};

export type MissingCoverRow = {
  albumId: number;
  artistName: string;
  albumTitle: string;
  externalKey: string | null;
};

export async function loadCoverSummary() {
  try {
    return await getCoverSummary();
  } catch {
    return {
      albumsWithLinks: 0,
      albumsMissingCovers: 0,
      r2CoverLinks: 0,
      curatedCovers: 0,
      unresolvedCovers: 0,
    };
  }
}

export async function loadCoverLinks(): Promise<CoverLinkRow[]> {
  try {
    return integrityQuery<CoverLinkRow>(
      `
      SELECT
        aal.album_id AS "albumId",
        ar.canonical_name AS "artistName",
        al.title AS "albumTitle",
        aal.canonical_cover_path AS "canonicalCoverPath",
        aal.r2_cover_key AS "r2CoverKey",
        aal.review_flag AS "reviewFlag",
        aal.source
      FROM album_artwork_links aal
      JOIN albums al ON al.id = aal.album_id
      JOIN artists ar ON ar.id = al.artist_id
      ORDER BY aal.review_flag, ar.canonical_name, al.title
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadMissingCovers(): Promise<MissingCoverRow[]> {
  try {
    return integrityQuery<MissingCoverRow>(
      `
      SELECT
        al.id AS "albumId",
        ar.canonical_name AS "artistName",
        al.title AS "albumTitle",
        ek.external_key AS "externalKey"
      FROM albums al
      JOIN artists ar ON ar.id = al.artist_id
      LEFT JOIN album_external_keys ek ON ek.album_id = al.id
      WHERE coalesce(al.canonical_cover_path, '') = ''
        AND NOT EXISTS (
          SELECT 1 FROM album_artwork_links aal
          WHERE aal.album_id = al.id
            AND (coalesce(aal.canonical_cover_path, '') <> '' OR coalesce(aal.r2_cover_key, '') <> '')
        )
      ORDER BY ar.canonical_name, al.title
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadR2CoverLinks(): Promise<CoverLinkRow[]> {
  try {
    return integrityQuery<CoverLinkRow>(
      `
      SELECT
        aal.album_id AS "albumId",
        ar.canonical_name AS "artistName",
        al.title AS "albumTitle",
        aal.canonical_cover_path AS "canonicalCoverPath",
        aal.r2_cover_key AS "r2CoverKey",
        aal.review_flag AS "reviewFlag",
        aal.source
      FROM album_artwork_links aal
      JOIN albums al ON al.id = aal.album_id
      JOIN artists ar ON ar.id = al.artist_id
      WHERE coalesce(aal.r2_cover_key, '') <> ''
      ORDER BY ar.canonical_name, al.title
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadCuratedCovers(): Promise<CoverLinkRow[]> {
  try {
    return integrityQuery<CoverLinkRow>(
      `
      SELECT
        aal.album_id AS "albumId",
        ar.canonical_name AS "artistName",
        al.title AS "albumTitle",
        aal.canonical_cover_path AS "canonicalCoverPath",
        aal.r2_cover_key AS "r2CoverKey",
        aal.review_flag AS "reviewFlag",
        aal.source
      FROM album_artwork_links aal
      JOIN albums al ON al.id = aal.album_id
      JOIN artists ar ON ar.id = al.artist_id
      WHERE aal.review_flag IN ('curated', 'ok')
        AND aal.source IN ('curator', 'curator_override', 'manual')
      ORDER BY aal.updated_at DESC NULLS LAST
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadCoverReviewQueue(): Promise<CoverLinkRow[]> {
  try {
    return integrityQuery<CoverLinkRow>(
      `
      SELECT
        aal.album_id AS "albumId",
        ar.canonical_name AS "artistName",
        al.title AS "albumTitle",
        aal.canonical_cover_path AS "canonicalCoverPath",
        aal.r2_cover_key AS "r2CoverKey",
        aal.review_flag AS "reviewFlag",
        aal.source
      FROM album_artwork_links aal
      JOIN albums al ON al.id = aal.album_id
      JOIN artists ar ON ar.id = al.artist_id
      WHERE aal.review_flag = 'review_required' OR aal.review_flag = 'pending'
      ORDER BY aal.confidence_score ASC NULLS FIRST, ar.canonical_name
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

const COVER_VIEWS = new Set<IntegrityView>([
  "cover-summary",
  "cover-links",
  "cover-missing",
  "cover-r2",
  "cover-curated",
  "cover-review",
]);

export function isCoverView(view: IntegrityView): boolean {
  return COVER_VIEWS.has(view);
}

export async function loadCoverExplorerSlice(view: IntegrityView): Promise<
  Pick<
    ExplorerData,
    "coverSummary" | "coverLinks" | "coverMissing" | "coverR2Links" | "coverCurated" | "coverReviewQueue"
  >
> {
  const empty = {
    coverSummary: null,
    coverLinks: [],
    coverMissing: [],
    coverR2Links: [],
    coverCurated: [],
    coverReviewQueue: [],
  };
  if (view === "cover-summary") {
    return { ...empty, coverSummary: await loadCoverSummary() };
  }
  if (view === "cover-links") {
    return { ...empty, coverLinks: await loadCoverLinks() };
  }
  if (view === "cover-missing") {
    return { ...empty, coverMissing: await loadMissingCovers() };
  }
  if (view === "cover-r2") {
    return { ...empty, coverR2Links: await loadR2CoverLinks() };
  }
  if (view === "cover-curated") {
    return { ...empty, coverCurated: await loadCuratedCovers() };
  }
  if (view === "cover-review") {
    return { ...empty, coverReviewQueue: await loadCoverReviewQueue() };
  }
  return empty;
}
