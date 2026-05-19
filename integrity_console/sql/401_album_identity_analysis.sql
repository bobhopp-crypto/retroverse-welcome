-- 401_album_identity_analysis.sql
-- Album graph integrity analysis. Read-only.

WITH album_stats AS (
  SELECT
    al.id AS album_id,
    al.title AS canonical_name,
    al.artist_id,
    a.canonical_name AS artist,
    al.release_year,
    count(DISTINCT ae.id)::int AS edition_count,
    count(DISTINCT t.id)::int AS track_count,
    count(DISTINCT ca.id)::int AS chart_rows_album,
    count(DISTINCT ca_track.id)::int AS chart_rows_via_tracks
  FROM albums al
  JOIN artists a ON a.id = al.artist_id
  LEFT JOIN album_editions ae ON ae.album_id = al.id
  LEFT JOIN tracks t ON t.album_id = al.id
  LEFT JOIN chart_appearances ca ON ca.album_id = al.id
  LEFT JOIN chart_appearances ca_track ON ca_track.track_id = t.id
  GROUP BY al.id, al.title, al.artist_id, a.canonical_name, al.release_year
),
dup_names AS (
  SELECT
    artist_id,
    lower(trim(regexp_replace(title, '\s+', ' ', 'g'))) AS norm_title,
    count(*) AS name_count
  FROM albums
  GROUP BY artist_id, lower(trim(regexp_replace(title, '\s+', ' ', 'g')))
  HAVING count(*) > 1
),
orphan_editions AS (
  SELECT ae.album_id, count(*)::int AS orphan_edition_rows
  FROM album_editions ae
  LEFT JOIN albums al ON al.id = ae.album_id
  WHERE al.id IS NULL
  GROUP BY ae.album_id
)
SELECT
  s.album_id,
  s.canonical_name,
  s.artist,
  s.edition_count,
  s.track_count,
  (s.chart_rows_album + s.chart_rows_via_tracks) AS chart_rows,
  CASE
    WHEN s.track_count = 0 AND s.edition_count = 0 THEN 'critical'
    WHEN s.track_count = 0 THEN 'warning'
    WHEN EXISTS (
      SELECT 1 FROM dup_names d
      WHERE d.artist_id = s.artist_id
        AND d.norm_title = lower(trim(regexp_replace(s.canonical_name, '\s+', ' ', 'g')))
    ) THEN 'review'
    WHEN s.chart_rows_album = 0 AND s.chart_rows_via_tracks = 0 THEN 'missing_chart_lineage'
    WHEN s.edition_count > 1
      AND NOT EXISTS (SELECT 1 FROM album_editions ae WHERE ae.album_id = s.album_id AND ae.is_canonical) THEN
      'edition_canonical_unset'
    ELSE 'ok'
  END AS integrity_status,
  concat_ws(
    '; ',
    CASE WHEN s.track_count = 0 THEN 'no tracks linked to album' END,
    CASE WHEN s.edition_count = 0 THEN 'no album_editions rows' END,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM dup_names d
        WHERE d.artist_id = s.artist_id
          AND d.norm_title = lower(trim(regexp_replace(s.canonical_name, '\s+', ' ', 'g')))
      ) THEN 'duplicate album title for artist'
    END,
    CASE
      WHEN s.chart_rows_album = 0 AND s.chart_rows_via_tracks = 0 THEN 'no chart_appearances on album or tracks'
    END,
    CASE
      WHEN s.edition_count > 1
        AND NOT EXISTS (SELECT 1 FROM album_editions ae WHERE ae.album_id = s.album_id AND ae.is_canonical) THEN
        'multiple editions but none marked is_canonical'
    END,
    CASE
      WHEN s.edition_count > 1 THEN 'probable duplicate editions — review edition_name rows'
    END
  ) AS notes
FROM album_stats s
ORDER BY
  CASE
    WHEN s.track_count = 0 AND s.edition_count = 0 THEN 1
    WHEN s.track_count = 0 THEN 2
    WHEN EXISTS (
      SELECT 1 FROM dup_names d
      WHERE d.artist_id = s.artist_id
        AND d.norm_title = lower(trim(regexp_replace(s.canonical_name, '\s+', ' ', 'g')))
    ) THEN 3
    WHEN s.chart_rows_album = 0 AND s.chart_rows_via_tracks = 0 THEN 4
    ELSE 5
  END,
  s.artist,
  s.canonical_name;
