-- 404_billboard_200_import_readiness.sql
-- Billboard 200 import readiness (structural). Read-only.
-- Returns summary metrics, then candidate rows.

WITH b200_existing AS (
  SELECT count(*)::int AS chart_rows
  FROM chart_appearances
  WHERE chart_name ILIKE '%billboard%200%'
     OR chart_name ILIKE '%b200%'
),
album_coverage AS (
  SELECT
    count(*)::int AS total_albums,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM tracks t WHERE t.album_id = al.id
    ))::int AS albums_with_tracks,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM album_editions ae WHERE ae.album_id = al.id
    ))::int AS albums_with_editions,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM chart_appearances ca WHERE ca.album_id = al.id
    ))::int AS albums_with_direct_chart_rows
  FROM albums al
),
artist_readiness AS (
  SELECT
    count(DISTINCT al.artist_id)::int AS artists_with_albums,
    count(DISTINCT al.artist_id) FILTER (WHERE EXISTS (
      SELECT 1 FROM track_families tf WHERE tf.canonical_artist_id = al.artist_id
    ))::int AS artists_with_track_families
  FROM albums al
),
dup_album_families AS (
  SELECT count(*)::int AS duplicate_family_groups
  FROM (
    SELECT
      al.artist_id,
      lower(trim(regexp_replace(al.title, '\s+', ' ', 'g'))) AS norm
    FROM albums al
    GROUP BY al.artist_id, lower(trim(regexp_replace(al.title, '\s+', ' ', 'g')))
    HAVING count(*) > 1
  ) d
),
readiness AS (
  SELECT
    least(100, greatest(0,
      (CASE WHEN ac.total_albums > 0 THEN 20 ELSE 0 END)
      + (CASE WHEN ac.albums_with_tracks::numeric / nullif(ac.total_albums, 0) >= 0.5 THEN 25 ELSE 10 END)
      + (CASE WHEN ar.artists_with_track_families > 0 THEN 25 ELSE 0 END)
      + (CASE WHEN dup.duplicate_family_groups = 0 THEN 20 ELSE 5 END)
      + (CASE WHEN be.chart_rows > 0 THEN 10 ELSE 0 END)
    ))::int AS import_readiness_score,
    ac.total_albums,
    ac.albums_with_tracks,
    be.chart_rows AS b200_chart_rows_existing,
    dup.duplicate_family_groups,
    ar.artists_with_albums,
    ar.artists_with_track_families
  FROM album_coverage ac
  CROSS JOIN b200_existing be
  CROSS JOIN artist_readiness ar
  CROSS JOIN dup_album_families dup
)
SELECT
  'SUMMARY' AS report_row_type,
  r.import_readiness_score::text AS import_readiness_score,
  NULL::bigint AS album_id,
  format(
    'albums=%s with_tracks=%s artists=%s track_families_ready=%s dup_title_groups=%s b200_rows=%s',
    r.total_albums,
    r.albums_with_tracks,
    r.artists_with_albums,
    r.artists_with_track_families,
    r.duplicate_family_groups,
    r.b200_chart_rows_existing
  ) AS detail,
  CASE
    WHEN r.b200_chart_rows_existing = 0 THEN 'Billboard 200 not imported yet — structural readiness only'
    ELSE 'Billboard 200 rows present'
  END AS review_required
FROM readiness r

UNION ALL

SELECT
  'SAFE_MATCH_CANDIDATE' AS report_row_type,
  '75'::text AS import_readiness_score,
  al.id AS album_id,
  al.title || ' · ' || a.canonical_name AS detail,
  'album has artist + tracks; safe anchor for future B200 match' AS review_required
FROM albums al
JOIN artists a ON a.id = al.artist_id
WHERE EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = al.id)
  AND NOT EXISTS (
    SELECT 1
    FROM albums al2
    WHERE al2.artist_id = al.artist_id
      AND al2.id <> al.id
      AND lower(trim(al2.title)) = lower(trim(al.title))
  )

UNION ALL

SELECT
  'REVIEW_REQUIRED' AS report_row_type,
  '45'::text AS import_readiness_score,
  al.id AS album_id,
  al.title || ' · ' || a.canonical_name AS detail,
  coalesce(notes.note, 'review before B200 import') AS review_required
FROM albums al
JOIN artists a ON a.id = al.artist_id
LEFT JOIN LATERAL (
  SELECT concat_ws('; ',
    CASE WHEN NOT EXISTS (SELECT 1 FROM tracks t WHERE t.album_id = al.id) THEN 'no tracks' END,
    CASE WHEN EXISTS (
      SELECT 1 FROM albums al2
      WHERE al2.artist_id = al.artist_id AND al2.id <> al.id
        AND lower(trim(al2.title)) = lower(trim(al.title))
    ) THEN 'duplicate title for artist' END,
    CASE WHEN NOT EXISTS (SELECT 1 FROM album_editions ae WHERE ae.album_id = al.id) THEN 'no edition rows' END
  ) AS note
) notes ON true
WHERE notes.note IS NOT NULL AND notes.note <> ''

ORDER BY report_row_type DESC, import_readiness_score DESC, album_id NULLS LAST;
