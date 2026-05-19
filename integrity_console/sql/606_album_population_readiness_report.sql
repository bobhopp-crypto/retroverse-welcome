-- 606_album_population_readiness_report.sql
-- Post Phase 6 canonical album population readiness. Read-only.

WITH pop_stats AS (
  SELECT
    count(*)::int AS registry_albums,
    count(DISTINCT canonical_artist_id)::int AS artists_with_registry
  FROM album_population_registry
),
album_stats AS (
  SELECT
    count(*)::int AS total_albums,
    (SELECT count(*)::int FROM album_editions) AS total_editions
  FROM albums
),
staging_stats AS (
  SELECT count(*)::int AS staging_rows FROM staging_billboard_200_weekly
),
chart_stats AS (
  SELECT
    count(*)::int AS b200_chart_rows,
    count(DISTINCT album_id)::int AS albums_with_b200
  FROM chart_appearances
  WHERE chart_name = 'Billboard 200'
),
linkage_stats AS (
  SELECT
    count(*)::int AS linkage_rows,
    count(*) FILTER (WHERE review_flag = 'ok')::int AS ok_rows,
    count(*) FILTER (WHERE chart_inserted)::int AS chart_inserted,
    count(*) FILTER (WHERE review_flag LIKE 'review%')::int AS review_required
  FROM album_chart_linkage_candidates
),
duplicate_families AS (
  SELECT
    r.canonical_artist_id,
    r.canonical_album_name,
    count(DISTINCT r.album_id)::int AS album_ids
  FROM album_population_registry r
  GROUP BY r.canonical_artist_id, r.canonical_album_name
  HAVING count(DISTINCT r.album_id) > 1
)
SELECT 'SUMMARY' AS section, metric, value::text AS detail
FROM (
  SELECT 'staging_billboard_rows' AS metric, staging_rows AS value FROM staging_stats
  UNION ALL SELECT 'registry_albums', registry_albums FROM pop_stats
  UNION ALL SELECT 'artists_with_registry', artists_with_registry FROM pop_stats
  UNION ALL SELECT 'total_albums', total_albums FROM album_stats
  UNION ALL SELECT 'total_editions', total_editions FROM album_stats
  UNION ALL SELECT 'b200_chart_rows', b200_chart_rows FROM chart_stats
  UNION ALL SELECT 'albums_with_b200', albums_with_b200 FROM chart_stats
  UNION ALL SELECT 'linkage_rows', linkage_rows FROM linkage_stats
  UNION ALL SELECT 'linkage_ok', ok_rows FROM linkage_stats
  UNION ALL SELECT 'linkage_chart_inserted', chart_inserted FROM linkage_stats
  UNION ALL SELECT 'linkage_review_required', review_required FROM linkage_stats
  UNION ALL SELECT 'duplicate_album_families', count(*)::int FROM duplicate_families
) s

UNION ALL

SELECT 'REVIEW_FLAG' AS section, review_flag AS metric, count(*)::text AS detail
FROM album_chart_linkage_candidates
GROUP BY review_flag

UNION ALL

SELECT section, metric, detail
FROM (
  SELECT
    'TOP_UNRESOLVED_ARTIST' AS section,
    s.source_artist AS metric,
    count(*)::text AS detail,
    count(*) AS sort_n
  FROM album_chart_linkage_candidates c
  JOIN staging_billboard_200_weekly s ON s.id = c.staging_row_id
  WHERE c.review_flag IN ('review_artist', 'review_artist_ambiguous', 'review_album')
  GROUP BY s.source_artist
  ORDER BY sort_n DESC
  LIMIT 25
) top_unresolved;
