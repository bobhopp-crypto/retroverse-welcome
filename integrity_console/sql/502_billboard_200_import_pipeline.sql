-- 502_billboard_200_import_pipeline.sql
-- Ingest Billboard 200 staging → linkage candidates → chart_appearances (additive).
-- Prerequisite: 501 + rows in staging_billboard_200_weekly
--
-- Load staging example (from SQLite export):
--   \copy staging_billboard_200_weekly (chart_date, chart_position, source_artist, source_album, weeks_on_chart, content_hash, source_row_id)
--   FROM '/path/billboard200_weekly.csv' CSV HEADER

BEGIN;

-- Step 1: build / refresh linkage candidates
INSERT INTO album_chart_linkage_candidates (
  staging_row_id,
  resolved_artist_id,
  resolved_album_id,
  match_method,
  confidence_score,
  review_flag
)
SELECT
  s.id,
  a.id AS resolved_artist_id,
  al.id AS resolved_album_id,
  CASE
    WHEN a.id IS NOT NULL AND al.id IS NOT NULL THEN 'artist_album_exact'
    WHEN a.id IS NOT NULL THEN 'artist_only'
    ELSE 'unresolved'
  END AS match_method,
  CASE
    WHEN a.id IS NOT NULL AND al.id IS NOT NULL THEN 90
    WHEN a.id IS NOT NULL THEN 55
    ELSE 20
  END AS confidence_score,
  CASE
    WHEN a.id IS NULL THEN 'review_artist'
    WHEN al.id IS NULL THEN 'review_album'
    WHEN EXISTS (
      SELECT 1 FROM albums al2
      WHERE al2.artist_id = a.id AND al2.id <> al.id
        AND lower(trim(al2.title)) = lower(trim(s.source_album))
    ) THEN 'review_duplicate_album'
    ELSE 'ok'
  END AS review_flag
FROM staging_billboard_200_weekly s
LEFT JOIN artists a
  ON lower(trim(a.canonical_name)) = lower(trim(s.source_artist))
LEFT JOIN albums al
  ON al.artist_id = a.id
 AND lower(trim(al.title)) = lower(trim(s.source_album))
ON CONFLICT (staging_row_id) DO UPDATE SET
  resolved_artist_id = EXCLUDED.resolved_artist_id,
  resolved_album_id = EXCLUDED.resolved_album_id,
  match_method = EXCLUDED.match_method,
  confidence_score = EXCLUDED.confidence_score,
  review_flag = EXCLUDED.review_flag;

-- Step 2: insert chart appearances (idempotent — never rewrite existing rows)
INSERT INTO chart_appearances (
  album_id,
  chart_date,
  chart_name,
  chart_position,
  weeks_on_chart
)
SELECT
  c.resolved_album_id,
  s.chart_date,
  'Billboard 200',
  s.chart_position,
  s.weeks_on_chart
FROM album_chart_linkage_candidates c
JOIN staging_billboard_200_weekly s ON s.id = c.staging_row_id
WHERE c.resolved_album_id IS NOT NULL
  AND c.review_flag = 'ok'
  AND c.confidence_score >= 85
  AND NOT EXISTS (
    SELECT 1
    FROM chart_appearances ca
    WHERE ca.album_id = c.resolved_album_id
      AND ca.chart_date = s.chart_date
      AND ca.chart_name = 'Billboard 200'
  );

-- Step 3: mark candidates that received chart rows
UPDATE album_chart_linkage_candidates c
SET chart_inserted = true
FROM staging_billboard_200_weekly s
WHERE s.id = c.staging_row_id
  AND c.resolved_album_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM chart_appearances ca
    WHERE ca.album_id = c.resolved_album_id
      AND ca.chart_date = s.chart_date
      AND ca.chart_name = 'Billboard 200'
  );

COMMIT;

-- Review queue
SELECT review_flag, count(*) AS row_count
FROM album_chart_linkage_candidates
GROUP BY review_flag
ORDER BY row_count DESC;
