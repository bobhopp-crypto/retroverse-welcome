-- 506_album_timeline_preview.sql
-- Read-only album timeline / Billboard 200 / lineage preview.

WITH b200 AS (
  SELECT
    album_id,
    min(chart_position) AS peak_position,
    count(*)::int AS weeks_on_chart,
    min(chart_date) AS first_chart_date,
    max(chart_date) AS last_chart_date
  FROM chart_appearances
  WHERE chart_name = 'Billboard 200'
    AND album_id IS NOT NULL
  GROUP BY album_id
),
edition_counts AS (
  SELECT album_id, count(*)::int AS edition_count
  FROM album_editions
  GROUP BY album_id
),
family_counts AS (
  SELECT
    t.album_id,
    count(DISTINCT tfm.track_family_id)::int AS track_family_count
  FROM tracks t
  JOIN track_family_members tfm ON tfm.track_id = t.id
  WHERE t.album_id IS NOT NULL
  GROUP BY t.album_id
),
lineage_counts AS (
  SELECT album_id, count(*)::int AS lineage_rows
  FROM album_track_lineage
  GROUP BY album_id
)
SELECT
  a.canonical_name AS artist,
  al.id AS album_id,
  al.title AS album,
  al.release_year,
  coalesce(ec.edition_count, 0) AS edition_count,
  coalesce(fc.track_family_count, 0) AS track_family_count,
  coalesce(lc.lineage_rows, 0) AS lineage_rows,
  b.peak_position AS b200_peak,
  coalesce(b.weeks_on_chart, 0) AS b200_weeks,
  b.first_chart_date AS b200_first_week,
  b.last_chart_date AS b200_last_week,
  CASE
    WHEN b.album_id IS NOT NULL AND al.release_year IS NOT NULL THEN 'chart_and_release_aligned'
    WHEN b.album_id IS NOT NULL THEN 'chart_lineage_present'
    WHEN al.release_year IS NOT NULL THEN 'release_year_only'
    ELSE 'sparse_metadata'
  END AS timeline_continuity
FROM albums al
JOIN artists a ON a.id = al.artist_id
LEFT JOIN b200 b ON b.album_id = al.id
LEFT JOIN edition_counts ec ON ec.album_id = al.id
LEFT JOIN family_counts fc ON fc.album_id = al.id
LEFT JOIN lineage_counts lc ON lc.album_id = al.id
ORDER BY b.peak_position NULLS LAST, b.weeks_on_chart DESC NULLS LAST, a.canonical_name, al.title
LIMIT 500;
