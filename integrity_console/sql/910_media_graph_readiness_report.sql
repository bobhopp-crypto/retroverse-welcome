-- 910_media_graph_readiness_report.sql
-- Phase 9 media graph readiness. Read-only.

WITH vdj AS (
  SELECT count(*)::int AS staging_rows FROM staging_virtualdj_tracks
),
media AS (
  SELECT
    count(*)::int AS media_assets,
    count(*) FILTER (WHERE source_system = 'virtualdj')::int AS vdj_assets,
    count(*) FILTER (WHERE r2_media_key IS NOT NULL OR source_path ~* 'DJ MEDIA/VIDEO')::int AS probable_r2,
    count(*) FILTER (
      WHERE coalesce(local_thumbnail_path, '') <> '' OR coalesce(r2_thumbnail_key, '') <> ''
    )::int AS thumb_refs
  FROM media_assets
),
links AS (
  SELECT
    count(*)::int AS media_track_links,
    count(*) FILTER (WHERE review_flag = 'ok')::int AS links_ok,
    count(DISTINCT track_id)::int AS linked_tracks
  FROM media_track_links
),
candidates AS (
  SELECT
    count(*)::int AS candidates,
    count(*) FILTER (WHERE review_flag = 'ok')::int AS candidates_ok
  FROM media_asset_link_candidates
),
yt AS (
  SELECT
    count(*)::int AS youtube_staging,
    count(DISTINCT youtube_video_id)::int AS youtube_videos
  FROM staging_youtube_link_imports
),
unresolved AS (
  SELECT count(*)::int AS unresolved_media
  FROM media_assets ma
  WHERE NOT EXISTS (SELECT 1 FROM media_track_links mtl WHERE mtl.media_asset_id = ma.id)
)
SELECT 'SUMMARY' AS section, metric, value::text AS detail
FROM (
  SELECT 'vdj_staging_rows' AS metric, staging_rows AS value FROM vdj
  UNION ALL SELECT 'media_assets', media_assets FROM media
  UNION ALL SELECT 'vdj_media_assets', vdj_assets FROM media
  UNION ALL SELECT 'media_track_links', media_track_links FROM links
  UNION ALL SELECT 'linked_tracks', linked_tracks FROM links
  UNION ALL SELECT 'link_candidates', candidates FROM candidates
  UNION ALL SELECT 'link_candidates_ok', candidates_ok FROM candidates
  UNION ALL SELECT 'probable_r2_paths', probable_r2 FROM media
  UNION ALL SELECT 'thumbnail_references', thumb_refs FROM media
  UNION ALL SELECT 'youtube_staging_rows', youtube_staging FROM yt
  UNION ALL SELECT 'youtube_videos_discovered', youtube_videos FROM yt
  UNION ALL SELECT 'unresolved_media_assets', unresolved_media FROM unresolved
) s

UNION ALL

SELECT section, metric, detail
FROM (
  SELECT
    'TOP_UNMATCHED_ARTIST' AS section,
    ma.artist_text AS metric,
    count(*)::text AS detail,
    count(*) AS sort_n
  FROM media_assets ma
  WHERE NOT EXISTS (SELECT 1 FROM media_track_links mtl WHERE mtl.media_asset_id = ma.id)
  GROUP BY ma.artist_text
  ORDER BY sort_n DESC
  LIMIT 20
) t

UNION ALL

SELECT section, metric, detail
FROM (
  SELECT
    'TOP_UNMATCHED_ALBUM' AS section,
    ma.album_text AS metric,
    count(*)::text AS detail,
    count(*) AS sort_n
  FROM media_assets ma
  WHERE ma.album_text IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM media_track_links mtl WHERE mtl.media_asset_id = ma.id)
  GROUP BY ma.album_text
  ORDER BY sort_n DESC
  LIMIT 20
) t2;
