import { integrityQuery } from "./pg";
import type {
  ExplorerData,
  IntegrityView,
  MediaAssetRow,
  MediaGraphSummary,
  R2SyncRow,
  ThumbnailCoverageRow,
  VdjAssetRow,
  VdjLinkageCandidateRow,
  YoutubeEnrichmentRow,
} from "./types";

export async function loadMediaGraphSummary(): Promise<MediaGraphSummary> {
  try {
    const rows = await integrityQuery<MediaGraphSummary>(
      `
      SELECT
        (SELECT count(*)::int FROM staging_virtualdj_tracks) AS vdj_staging,
        (SELECT count(*)::int FROM media_assets) AS media_assets,
        (SELECT count(*)::int FROM media_assets WHERE source_system = 'virtualdj') AS vdj_media_assets,
        (SELECT count(DISTINCT track_id)::int FROM media_track_links WHERE track_id IS NOT NULL) AS linked_tracks,
        (
          SELECT count(*)::int FROM media_assets ma
          WHERE coalesce(ma.local_thumbnail_path, '') <> '' OR coalesce(ma.r2_thumbnail_key, '') <> ''
        ) AS thumbnail_refs,
        (
          SELECT count(*)::int FROM media_assets ma
          WHERE ma.r2_media_key IS NOT NULL OR ma.source_path ~* 'DJ MEDIA/VIDEO'
        ) AS probable_r2,
        (
          SELECT count(*)::int FROM media_assets ma
          WHERE NOT EXISTS (SELECT 1 FROM media_track_links mtl WHERE mtl.media_asset_id = ma.id)
        ) AS unresolved_media,
        (SELECT count(*)::int FROM staging_youtube_link_imports) AS youtube_staging,
        (SELECT count(DISTINCT youtube_video_id)::int FROM staging_youtube_link_imports) AS youtube_videos
      `,
    );
    return (
      rows[0] ?? {
        vdj_staging: 0,
        media_assets: 0,
        vdj_media_assets: 0,
        linked_tracks: 0,
        thumbnail_refs: 0,
        probable_r2: 0,
        unresolved_media: 0,
        youtube_staging: 0,
        youtube_videos: 0,
      }
    );
  } catch {
    return {
      vdj_staging: 0,
      media_assets: 0,
      vdj_media_assets: 0,
      linked_tracks: 0,
      thumbnail_refs: 0,
      probable_r2: 0,
      unresolved_media: 0,
      youtube_staging: 0,
      youtube_videos: 0,
    };
  }
}

export async function loadMediaAssetsPhase9(): Promise<MediaAssetRow[]> {
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
        ma.vdj_guid,
        ma.play_count,
        ma.r2_media_key,
        ma.local_thumbnail_path,
        EXISTS (SELECT 1 FROM media_track_links mtl WHERE mtl.media_asset_id = ma.id) AS linked
      FROM media_assets ma
      ORDER BY ma.source_system, ma.artist_text, ma.title_text
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadVdjAssets(): Promise<VdjAssetRow[]> {
  try {
    return integrityQuery<VdjAssetRow>(
      `
      SELECT
        v.id,
        v.source_path,
        v.filename,
        v.artist_text,
        v.title_text,
        v.play_count,
        v.duration_seconds,
        v.vdj_guid,
        v.thumbnail_path
      FROM staging_virtualdj_tracks v
      ORDER BY v.play_count DESC NULLS LAST, v.artist_text, v.title_text
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadMediaLinkageCandidates(): Promise<VdjLinkageCandidateRow[]> {
  try {
    return integrityQuery<VdjLinkageCandidateRow>(
      `
      SELECT
        c.staging_virtualdj_id AS vdj_staging_id,
        v.source_path,
        v.artist_text,
        v.title_text,
        c.candidate_track_id,
        c.candidate_track_family_id,
        c.candidate_album_id,
        c.confidence_score,
        c.match_reason,
        c.review_flag
      FROM media_asset_link_candidates c
      JOIN staging_virtualdj_tracks v ON v.id = c.staging_virtualdj_id
      ORDER BY c.confidence_score DESC NULLS LAST
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadR2SyncAnalysis(): Promise<R2SyncRow[]> {
  try {
    return integrityQuery<R2SyncRow>(
      `
      WITH assets AS (
        SELECT
          ma.id,
          ma.source_path,
          ma.artist_text,
          ma.title_text,
          ma.r2_media_key,
          ma.r2_thumbnail_key,
          ma.local_thumbnail_path,
          CASE
            WHEN ma.source_path ~* '^/Users/bobhopp/DJ MEDIA/VIDEO/'
              THEN 'video/' || regexp_replace(
                regexp_replace(trim(both '/' FROM substring(ma.source_path FROM 'VIDEO/(.+)$')), ' ', '%20', 'g'),
                '''', '%27', 'g'
              )
            WHEN ma.source_path ~* '\\.(mp4|mov|m4v)$' AND ma.filename IS NOT NULL
              THEN 'video/' || regexp_replace(ma.filename, ' ', '%20', 'g')
            ELSE NULL
          END AS probable_r2_media_key
        FROM media_assets ma
        WHERE ma.source_system = 'virtualdj'
      )
      SELECT
        a.id,
        a.artist_text,
        a.title_text,
        a.source_path,
        coalesce(a.r2_media_key, a.probable_r2_media_key) AS probable_r2_media_key,
        a.r2_thumbnail_key AS probable_r2_thumbnail_key,
        (
          a.r2_thumbnail_key IS NULL
          AND coalesce(a.local_thumbnail_path, '') = ''
        ) AS missing_thumbnail,
        (coalesce(a.r2_media_key, a.probable_r2_media_key) IS NULL) AS missing_r2_asset,
        CASE
          WHEN a.r2_media_key IS NOT NULL THEN 'linked'
          WHEN a.probable_r2_media_key IS NOT NULL THEN 'probable'
          ELSE 'missing_r2_asset'
        END AS sync_status
      FROM assets a
      ORDER BY sync_status, a.artist_text, a.title_text
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadThumbnailCoverage(): Promise<ThumbnailCoverageRow[]> {
  try {
    return integrityQuery<ThumbnailCoverageRow>(
      `
      SELECT
        ma.id,
        ma.artist_text,
        ma.title_text,
        ma.source_path,
        ma.local_thumbnail_path,
        ma.r2_thumbnail_key,
        CASE
          WHEN coalesce(ma.r2_thumbnail_key, '') <> '' THEN 'r2'
          WHEN coalesce(ma.local_thumbnail_path, '') <> '' THEN 'local'
          ELSE 'missing'
        END AS coverage_status
      FROM media_assets ma
      WHERE ma.source_system = 'virtualdj'
      ORDER BY coverage_status DESC, ma.artist_text, ma.title_text
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadYoutubeEnrichment(): Promise<YoutubeEnrichmentRow[]> {
  try {
    return integrityQuery<YoutubeEnrichmentRow>(
      `
      SELECT
        s.id,
        s.artist_text,
        s.title_text,
        s.youtube_url,
        s.youtube_video_id,
        s.source_name AS source,
        t.id AS candidate_track_id,
        CASE
          WHEN t.id IS NOT NULL AND lower(trim(t.title)) = lower(trim(s.title_text)) THEN 90
          WHEN t.id IS NOT NULL THEN 70
          ELSE 30
        END AS confidence_score,
        CASE WHEN t.id IS NOT NULL THEN 'ok' ELSE 'review_required' END AS review_flag
      FROM staging_youtube_link_imports s
      LEFT JOIN artists a
        ON lower(trim(a.canonical_name)) = lower(trim(regexp_replace(coalesce(s.artist_text, ''), '\\s+', ' ', 'g')))
      LEFT JOIN LATERAL (
        SELECT t.id, t.title
        FROM tracks t
        WHERE t.artist_id = a.id
          AND lower(trim(t.title)) = lower(trim(regexp_replace(coalesce(s.title_text, ''), '\\s+', ' ', 'g')))
        ORDER BY t.id
        LIMIT 1
      ) t ON true
      ORDER BY confidence_score DESC
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

const MEDIA_VIEWS = new Set<IntegrityView>([
  "media-graph",
  "media",
  "vdj-assets",
  "vdj",
  "r2-sync",
  "thumbnail-coverage",
  "youtube-enrichment",
]);

export function isMediaView(view: IntegrityView): boolean {
  return MEDIA_VIEWS.has(view);
}

export async function loadMediaExplorerSlice(view: IntegrityView): Promise<
  Pick<
    ExplorerData,
    | "mediaGraphSummary"
    | "mediaAssets"
    | "vdjAssets"
    | "vdjCandidates"
    | "r2SyncRows"
    | "thumbnailCoverage"
    | "youtubeEnrichment"
  >
> {
  const empty = {
    mediaGraphSummary: null,
    mediaAssets: [],
    vdjAssets: [],
    vdjCandidates: [],
    r2SyncRows: [],
    thumbnailCoverage: [],
    youtubeEnrichment: [],
  };

  if (view === "media-graph") {
    return { ...empty, mediaGraphSummary: await loadMediaGraphSummary() };
  }
  if (view === "media") {
    return { ...empty, mediaAssets: await loadMediaAssetsPhase9() };
  }
  if (view === "vdj-assets") {
    return { ...empty, vdjAssets: await loadVdjAssets() };
  }
  if (view === "vdj") {
    return { ...empty, vdjCandidates: await loadMediaLinkageCandidates() };
  }
  if (view === "r2-sync") {
    return { ...empty, r2SyncRows: await loadR2SyncAnalysis() };
  }
  if (view === "thumbnail-coverage") {
    return { ...empty, thumbnailCoverage: await loadThumbnailCoverage() };
  }
  if (view === "youtube-enrichment") {
    return { ...empty, youtubeEnrichment: await loadYoutubeEnrichment() };
  }
  return empty;
}
