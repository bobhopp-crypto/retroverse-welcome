import { integrityQuery } from "./pg";
import type {
  AlbumTrackLinkRow,
  ExplorerData,
  Hot100AlbumLinkRow,
  IntegrityView,
  LinkageSummary,
  MediaAssetRow,
  VdjLinkageCandidateRow,
} from "./types";

export async function loadLinkageSummary(): Promise<LinkageSummary> {
  try {
    const rows = await integrityQuery<{
      ctal_total: number;
      ctal_ok: number;
      chart_links: number;
      chart_ok: number;
      hot100_unresolved: number;
      vdj_staging: number;
      media_assets: number;
    }>(
      `
      SELECT
        (SELECT count(*)::int FROM canonical_track_album_links) AS ctal_total,
        (SELECT count(*)::int FROM canonical_track_album_links WHERE review_flag = 'ok') AS ctal_ok,
        (SELECT count(*)::int FROM chart_track_album_links) AS chart_links,
        (SELECT count(*)::int FROM chart_track_album_links WHERE review_flag = 'ok') AS chart_ok,
        (
          SELECT count(*)::int
          FROM chart_appearances ca
          WHERE ca.chart_name = 'Billboard Hot 100'
            AND ca.track_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM chart_track_album_links l WHERE l.chart_appearance_id = ca.id
            )
        ) AS hot100_unresolved,
        (SELECT count(*)::int FROM staging_virtualdj_tracks) AS vdj_staging,
        (SELECT count(*)::int FROM media_assets) AS media_assets
      `,
    );
    return rows[0] ?? {
      ctal_total: 0,
      ctal_ok: 0,
      chart_links: 0,
      chart_ok: 0,
      hot100_unresolved: 0,
      vdj_staging: 0,
      media_assets: 0,
    };
  } catch {
    return {
      ctal_total: 0,
      ctal_ok: 0,
      chart_links: 0,
      chart_ok: 0,
      hot100_unresolved: 0,
      vdj_staging: 0,
      media_assets: 0,
    };
  }
}

export async function loadAlbumTrackLinks(): Promise<AlbumTrackLinkRow[]> {
  try {
    return integrityQuery<AlbumTrackLinkRow>(
      `
      SELECT
        ctal.id,
        tf.canonical_name AS track_family_name,
        a.canonical_name AS artist_name,
        al.title AS album_title,
        ae.edition_name,
        ctal.track_number,
        ctal.disc_number,
        ctal.confidence_score,
        ctal.source,
        ctal.review_flag
      FROM canonical_track_album_links ctal
      JOIN track_families tf ON tf.id = ctal.track_family_id
      JOIN albums al ON al.id = ctal.album_id
      JOIN artists a ON a.id = al.artist_id
      LEFT JOIN album_editions ae ON ae.id = ctal.album_edition_id
      ORDER BY ctal.review_flag, a.canonical_name, al.title, ctal.track_number NULLS LAST
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadHot100AlbumLinks(): Promise<Hot100AlbumLinkRow[]> {
  try {
    return integrityQuery<Hot100AlbumLinkRow>(
      `
      SELECT
        l.id,
        ca.chart_date::text,
        ca.chart_position,
        ar.canonical_name AS artist,
        t.title AS track_title,
        al.title AS album_title,
        l.confidence_score,
        l.review_flag
      FROM chart_track_album_links l
      JOIN chart_appearances ca ON ca.id = l.chart_appearance_id
      JOIN tracks t ON t.id = l.track_id
      JOIN artists ar ON ar.id = t.artist_id
      LEFT JOIN albums al ON al.id = l.album_id
      WHERE ca.chart_name = 'Billboard Hot 100'
      ORDER BY ca.chart_date DESC, ca.chart_position
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadMediaAssets(): Promise<MediaAssetRow[]> {
  try {
    return integrityQuery<MediaAssetRow>(
      `
      SELECT
        ma.id,
        ma.source_system,
        ma.filename,
        ma.artist_text,
        ma.title_text,
        ma.album_text,
        ma.duration_seconds,
        ma.vdj_guid
      FROM media_assets ma
      ORDER BY ma.source_system, ma.artist_text, ma.title_text
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadVdjLinkageCandidates(): Promise<VdjLinkageCandidateRow[]> {
  try {
    return integrityQuery<VdjLinkageCandidateRow>(
      `
      WITH staging_norm AS (
        SELECT
          v.id AS vdj_staging_id,
          v.source_path,
          v.artist_text,
          v.title_text,
          v.duration_seconds,
          lower(trim(regexp_replace(coalesce(v.artist_text, ''), '\\s+', ' ', 'g'))) AS norm_artist,
          lower(trim(regexp_replace(coalesce(v.title_text, ''), '\\s+', ' ', 'g'))) AS norm_title
        FROM staging_virtualdj_tracks v
      ),
      track_match AS (
        SELECT
          sn.vdj_staging_id,
          sn.source_path,
          sn.artist_text,
          sn.title_text,
          t.id AS candidate_track_id,
          tfm.track_family_id AS candidate_track_family_id,
          t.album_id AS candidate_album_id,
          CASE
            WHEN lower(trim(a.canonical_name)) = sn.norm_artist
             AND lower(trim(t.title)) = sn.norm_title THEN 95
            WHEN lower(trim(t.title)) = sn.norm_title THEN 75
            ELSE 55
          END AS confidence_score,
          CASE
            WHEN lower(trim(a.canonical_name)) = sn.norm_artist
             AND lower(trim(t.title)) = sn.norm_title THEN 'artist_title_exact'
            ELSE 'title_exact'
          END AS match_reason,
          row_number() OVER (
            PARTITION BY sn.vdj_staging_id
            ORDER BY
              (lower(trim(a.canonical_name)) = sn.norm_artist AND lower(trim(t.title)) = sn.norm_title) DESC,
              t.id
          ) AS rn
        FROM staging_norm sn
        JOIN tracks t ON lower(trim(t.title)) = sn.norm_title
        LEFT JOIN artists a ON a.id = t.artist_id
        LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
        WHERE sn.norm_title <> ''
      )
      SELECT
        vdj_staging_id,
        source_path,
        artist_text,
        title_text,
        candidate_track_id,
        candidate_track_family_id,
        candidate_album_id,
        confidence_score,
        match_reason,
        CASE WHEN confidence_score >= 90 THEN 'ok' ELSE 'review_required' END AS review_flag
      FROM track_match
      WHERE rn = 1
      ORDER BY confidence_score DESC
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

const LINKAGE_VIEWS = new Set<IntegrityView>([
  "linkage",
  "hot100-album",
  "album-track-links",
]);

export function isLinkageView(view: IntegrityView): boolean {
  return LINKAGE_VIEWS.has(view);
}

export async function loadLinkageExplorerSlice(view: IntegrityView): Promise<
  Pick<ExplorerData, "linkageSummary" | "albumTrackLinks" | "hot100AlbumLinks">
> {
  if (view === "linkage") {
    return {
      linkageSummary: await loadLinkageSummary(),
      albumTrackLinks: [],
      hot100AlbumLinks: [],
    };
  }
  if (view === "album-track-links") {
    return {
      linkageSummary: null,
      albumTrackLinks: await loadAlbumTrackLinks(),
      hot100AlbumLinks: [],
    };
  }
  if (view === "hot100-album") {
    return {
      linkageSummary: null,
      albumTrackLinks: [],
      hot100AlbumLinks: await loadHot100AlbumLinks(),
    };
  }
  return {
    linkageSummary: null,
    albumTrackLinks: [],
    hot100AlbumLinks: [],
  };
}
