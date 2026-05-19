-- 505_billboard_200_readiness_report.sql
-- Post-ingestion readiness: coverage, linkage, MusicBrainz quality. Read-only.

WITH staging_stats AS (
  SELECT count(*)::int AS staging_rows FROM staging_billboard_200_weekly
),
chart_stats AS (
  SELECT
    count(*)::int AS b200_chart_rows,
    count(DISTINCT album_id)::int AS albums_with_b200,
    min(chart_date) AS first_date,
    max(chart_date) AS last_date
  FROM chart_appearances
  WHERE chart_name = 'Billboard 200'
),
linkage_stats AS (
  SELECT
    count(*)::int AS candidates,
    count(*) FILTER (WHERE review_flag = 'ok')::int AS ok_candidates,
    count(*) FILTER (WHERE chart_inserted)::int AS chart_inserted,
    count(*) FILTER (WHERE review_flag LIKE 'review%')::int AS review_required
  FROM album_chart_linkage_candidates
),
tracklist_stats AS (
  SELECT
    count(*)::int AS staging_tracklist_rows,
    count(*) FILTER (WHERE mb_recording_mbid IS NOT NULL)::int AS with_recording_mbid
  FROM staging_album_tracklist_imports
),
mb_stats AS (
  SELECT
    count(*)::int AS mb_releases,
    count(*) FILTER (WHERE mapped_album_id IS NOT NULL)::int AS mapped_releases,
    count(*) FILTER (WHERE mapping_status = 'pending')::int AS pending_mappings
  FROM staging_musicbrainz_release_mappings
),
lineage_stats AS (
  SELECT count(*)::int AS lineage_rows, count(DISTINCT album_id)::int AS albums_with_lineage
  FROM album_track_lineage
),
by_year AS (
  SELECT
    extract(year FROM chart_date)::int AS chart_year,
    count(*)::int AS weekly_rows
  FROM chart_appearances
  WHERE chart_name = 'Billboard 200'
  GROUP BY extract(year FROM chart_date)
  ORDER BY chart_year
)
SELECT 'SUMMARY' AS section, metric, value::text AS detail
FROM (
  SELECT 'staging_billboard_rows' AS metric, staging_rows AS value FROM staging_stats
  UNION ALL SELECT 'b200_chart_rows', b200_chart_rows FROM chart_stats
  UNION ALL SELECT 'albums_with_b200', albums_with_b200 FROM chart_stats
  UNION ALL SELECT 'linkage_candidates', candidates FROM linkage_stats
  UNION ALL SELECT 'linkage_ok', ok_candidates FROM linkage_stats
  UNION ALL SELECT 'linkage_review_required', review_required FROM linkage_stats
  UNION ALL SELECT 'staging_tracklist_rows', staging_tracklist_rows FROM tracklist_stats
  UNION ALL SELECT 'mb_releases_staged', mb_releases FROM mb_stats
  UNION ALL SELECT 'mb_mapped_releases', mapped_releases FROM mb_stats
  UNION ALL SELECT 'album_track_lineage_rows', lineage_rows FROM lineage_stats
  UNION ALL SELECT 'albums_with_lineage', albums_with_lineage FROM lineage_stats
) s

UNION ALL

SELECT 'YEAR_COVERAGE' AS section, chart_year::text AS metric, weekly_rows::text AS detail
FROM by_year

UNION ALL

SELECT section, metric, detail
FROM (
  SELECT
    'UNRESOLVED_ALBUM' AS section,
    s.source_album AS metric,
    s.source_artist AS detail
  FROM album_chart_linkage_candidates c
  JOIN staging_billboard_200_weekly s ON s.id = c.staging_row_id
  WHERE c.review_flag IN ('review_album', 'review_artist', 'review_duplicate_album')
  ORDER BY s.source_artist, s.source_album
  LIMIT 100
) unresolved;
