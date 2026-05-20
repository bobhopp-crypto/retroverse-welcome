-- 708_linkage_readiness_report.sql
-- Phase 7 linkage readiness. Read-only.

WITH ctal_stats AS (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE review_flag = 'ok')::int AS ok_rows,
    count(*) FILTER (WHERE review_flag = 'review_required')::int AS review_rows
  FROM canonical_track_album_links
),
chart_link_stats AS (
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE review_flag = 'ok')::int AS ok_rows,
    count(*) FILTER (WHERE review_flag = 'review_required')::int AS review_rows
  FROM chart_track_album_links
),
hot100_stats AS (
  SELECT count(*)::int AS hot100_rows
  FROM chart_appearances
  WHERE chart_name = 'Billboard Hot 100' AND track_id IS NOT NULL
),
unresolved_hot100 AS (
  SELECT count(*)::int AS unresolved
  FROM chart_appearances ca
  WHERE ca.chart_name = 'Billboard Hot 100'
    AND ca.track_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM chart_track_album_links l WHERE l.chart_appearance_id = ca.id
    )
),
vdj_stats AS (
  SELECT count(*)::int AS staging_rows FROM staging_virtualdj_tracks
),
media_stats AS (
  SELECT
    (SELECT count(*)::int FROM media_assets) AS media_assets,
    (SELECT count(*)::int FROM media_track_links) AS media_track_links
)
SELECT 'SUMMARY' AS section, metric, value::text AS detail
FROM (
  SELECT 'canonical_track_album_links' AS metric, total AS value FROM ctal_stats
  UNION ALL SELECT 'ctal_ok', ok_rows FROM ctal_stats
  UNION ALL SELECT 'ctal_review_required', review_rows FROM ctal_stats
  UNION ALL SELECT 'chart_track_album_links', total FROM chart_link_stats
  UNION ALL SELECT 'chart_album_ok', ok_rows FROM chart_link_stats
  UNION ALL SELECT 'chart_album_review_required', review_rows FROM chart_link_stats
  UNION ALL SELECT 'hot100_chart_rows', hot100_rows FROM hot100_stats
  UNION ALL SELECT 'hot100_unresolved_album', unresolved FROM unresolved_hot100
  UNION ALL SELECT 'vdj_staging_rows', staging_rows FROM vdj_stats
  UNION ALL SELECT 'media_assets', media_assets FROM media_stats
  UNION ALL SELECT 'media_track_links', media_track_links FROM media_stats
) s

UNION ALL

SELECT section, metric, detail
FROM (
  SELECT
    'TOP_ARTIST_MISSING_ALBUM_LINK' AS section,
    a.canonical_name AS metric,
    count(*)::text AS detail,
    count(*) AS sort_n
  FROM (
    SELECT DISTINCT tf.canonical_artist_id
    FROM track_families tf
    WHERE NOT EXISTS (
      SELECT 1 FROM canonical_track_album_links ctal
      WHERE ctal.track_family_id = tf.id
    )
  ) missing
  JOIN artists a ON a.id = missing.canonical_artist_id
  GROUP BY a.canonical_name
  ORDER BY sort_n DESC
  LIMIT 25
) top_missing;
