-- 1202_canonical_track_graph_report.sql
-- Canonical track graph readiness (Hot 100 + VDJ eligibility rule).

\echo '=== Canonical track graph summary ==='

WITH stats AS (
  SELECT
    count(*)::int AS total_canonical_tracks,
    count(*) FILTER (WHERE has_hot100)::int AS hot100_backed,
    count(*) FILTER (WHERE has_vdj_media)::int AS vdj_backed,
    count(*) FILTER (WHERE has_hot100 AND has_vdj_media)::int AS both_backed,
    count(*) FILTER (WHERE NOT has_hot100 AND NOT has_vdj_media)::int AS ineligible_rows,
    count(*) FILTER (WHERE NOT has_video AND NOT has_audio AND NOT has_youtube AND has_vdj_media)::int AS vdj_without_media_flags,
    count(*) FILTER (WHERE has_hot100 AND peak_hot100_position IS NULL)::int AS hot100_missing_peak,
    count(*) FILTER (WHERE review_flag <> 'ok')::int AS review_flagged
  FROM canonical_tracks
),
version_stats AS (
  SELECT
    count(*)::int AS total_versions,
    count(DISTINCT canonical_track_id)::int AS tracks_with_versions,
    count(*) FILTER (WHERE source_type = 'graph_track')::int AS graph_track_versions,
    count(*) FILTER (WHERE source_type = 'acoustic')::int AS acoustic_versions,
    count(*) FILTER (WHERE source_type = 'vdj_media')::int AS vdj_versions,
    count(*) FILTER (WHERE is_primary)::int AS primary_versions
  FROM canonical_track_versions
),
album_link AS (
  SELECT
    count(*)::int AS album_canonical_rows,
    count(*) FILTER (WHERE canonical_track_key IS NOT NULL)::int AS album_rows_with_rvtr,
    count(*) FILTER (WHERE canonical_track_key IS NULL)::int AS album_rows_missing_rvtr
  FROM canonical_album_tracks
),
dup_candidates AS (
  SELECT
    ct.canonical_artist_name,
    ct.normalized_title_key,
    count(*)::int AS entity_count,
    string_agg(ct.track_id, ', ' ORDER BY ct.peak_hot100_position NULLS LAST, ct.track_id) AS track_ids
  FROM canonical_tracks ct
  GROUP BY ct.canonical_artist_name, ct.normalized_title_key
  HAVING count(*) > 1
),
orphan_acoustic AS (
  SELECT count(*)::int AS orphan_acoustic_rows
  FROM staging_acoustic_tracks sat
  WHERE NOT EXISTS (
    SELECT 1
    FROM canonical_track_versions v
    WHERE v.acoustic_source_id = sat.id
  )
)
SELECT * FROM stats;

SELECT '--- version stats ---' AS section;
SELECT * FROM version_stats;

SELECT '--- album RVTR linkage ---' AS section;
SELECT * FROM album_link;

SELECT '--- duplicate canonical candidates (top 25) ---' AS section;
SELECT * FROM dup_candidates ORDER BY entity_count DESC, canonical_artist_name LIMIT 25;

SELECT '--- orphan acoustic rows (not attached to any canonical version) ---' AS section;
SELECT * FROM orphan_acoustic;

\echo '=== Sample canonical tracks (high signal) ==='
SELECT
  track_id,
  canonical_title,
  canonical_artist_name,
  peak_hot100_position,
  chart_weeks,
  has_hot100,
  has_vdj_media,
  identity_source
FROM canonical_track_display
WHERE lower(canonical_title) IN (
  'billie jean',
  'thriller',
  'beat it',
  'hotel california',
  'brown eyed girl'
)
ORDER BY canonical_artist_name, canonical_title;
