-- 1103_canonical_album_tracks_report.sql
-- Read-only readiness report for canonical_album_tracks.

WITH stats AS (
  SELECT
    count(*)::int AS total_rows,
    count(DISTINCT album_id)::int AS albums_with_tracks,
    count(*) FILTER (WHERE acoustic_source_id IS NOT NULL)::int AS rows_with_acoustic,
    count(*) FILTER (WHERE acoustic_source_id IS NULL)::int AS rows_missing_acoustic,
    count(*) FILTER (WHERE review_flag = 'review_required')::int AS review_required_rows,
    count(DISTINCT album_id) FILTER (
      WHERE album_id IN (
        SELECT album_id FROM canonical_album_tracks GROUP BY album_id HAVING count(*) >= 6
      )
    )::int AS albums_ge6
  FROM canonical_album_tracks
),
thriller AS (
  SELECT
    cat.position,
    cat.title,
    cat.acoustic_source_id,
    sat.source_song AS acoustic_title,
    d.signal_score
  FROM canonical_album_tracks cat
  JOIN album_external_keys aek ON aek.album_id = cat.album_id AND aek.external_key = 'RVAL586982'
  LEFT JOIN canonical_album_track_display d ON d.id = cat.id
  LEFT JOIN staging_acoustic_tracks sat ON sat.id = cat.acoustic_source_id
  ORDER BY cat.position
),
beat_it AS (
  SELECT
    cat.title,
    cat.acoustic_source_id,
    sat.source_song AS matched_acoustic,
    d.signal_score,
    CASE
      WHEN cat.acoustic_source_id IS NULL THEN 'no_acoustic_row_scored_above_threshold'
      ELSE 'attached'
    END AS match_status
  FROM canonical_album_tracks cat
  JOIN album_external_keys aek ON aek.album_id = cat.album_id AND aek.external_key = 'RVAL586982'
  LEFT JOIN canonical_album_track_display d ON d.id = cat.id
  LEFT JOIN staging_acoustic_tracks sat ON sat.id = cat.acoustic_source_id
  WHERE lower(trim(cat.title)) LIKE '%beat it%'
),
missing_albums AS (
  SELECT
    aek.external_key,
    al.title AS album_title,
    ar.canonical_name AS artist_name,
    min(ca.chart_position) AS peak_rank
  FROM album_external_keys aek
  JOIN albums al ON al.id = aek.album_id
  JOIN artists ar ON ar.id = al.artist_id
  LEFT JOIN canonical_album_tracks cat ON cat.album_id = aek.album_id
  LEFT JOIN chart_appearances ca
    ON ca.album_id = aek.album_id AND ca.chart_name = 'Billboard 200'
  WHERE cat.id IS NULL
  GROUP BY aek.external_key, al.title, ar.canonical_name
  ORDER BY peak_rank NULLS LAST, al.title
  LIMIT 25
)
SELECT 'SUMMARY' AS section, metric, value::text AS detail
FROM (
  SELECT 'total_canonical_rows' AS metric, total_rows AS value FROM stats
  UNION ALL SELECT 'albums_with_canonical_tracks', albums_with_tracks FROM stats
  UNION ALL SELECT 'albums_with_ge6_tracks', albums_ge6 FROM stats
  UNION ALL SELECT 'rows_with_acoustic_enrichment', rows_with_acoustic FROM stats
  UNION ALL SELECT 'rows_missing_acoustic', rows_missing_acoustic FROM stats
  UNION ALL SELECT 'review_required_rows', review_required_rows FROM stats
) s

UNION ALL

SELECT 'THRILLER_TRACKS' AS section, position::text AS metric, title AS detail
FROM thriller

UNION ALL

SELECT 'BEAT_IT_DIAGNOSIS' AS section, match_status AS metric,
       coalesce(matched_acoustic, '(none)') AS detail
FROM beat_it

UNION ALL

SELECT 'TOP_MISSING_SEQUENCES' AS section, coalesce(external_key, '?') AS metric,
       artist_name || ' — ' || album_title || coalesce(' peak #' || peak_rank::text, '') AS detail
FROM missing_albums;
