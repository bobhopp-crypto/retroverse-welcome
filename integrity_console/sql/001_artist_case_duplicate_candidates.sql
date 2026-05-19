-- 001_artist_case_duplicate_candidates.sql
-- Find artist rows that likely duplicate each other (case / whitespace variants).
-- Read-only. Safe to run anytime.

WITH artist_stats AS (
  SELECT
    a.id AS artist_id,
    a.canonical_name AS artist_name,
    lower(trim(regexp_replace(a.canonical_name, '\s+', ' ', 'g'))) AS normalized_name,
    (a.canonical_name <> lower(a.canonical_name)) AS has_mixed_case,
    coalesce(t.track_count, 0) AS track_count,
    coalesce(al.album_count, 0) AS album_count,
    coalesce(aa.alias_count, 0) AS alias_count,
    coalesce(ch.chart_row_count, 0) AS chart_row_count
  FROM artists a
  LEFT JOIN (
    SELECT artist_id, count(*)::int AS track_count
    FROM tracks
    GROUP BY artist_id
  ) t ON t.artist_id = a.id
  LEFT JOIN (
    SELECT artist_id, count(*)::int AS album_count
    FROM albums
    GROUP BY artist_id
  ) al ON al.artist_id = a.id
  LEFT JOIN (
    SELECT artist_id, count(*)::int AS alias_count
    FROM artist_aliases
    GROUP BY artist_id
  ) aa ON aa.artist_id = a.id
  LEFT JOIN (
    SELECT tr.artist_id, count(*)::int AS chart_row_count
    FROM chart_appearances ca
    JOIN tracks tr ON tr.id = ca.track_id
    WHERE tr.artist_id IS NOT NULL
    GROUP BY tr.artist_id
  ) ch ON ch.artist_id = a.id
),
duplicate_groups AS (
  SELECT normalized_name
  FROM artist_stats
  GROUP BY normalized_name
  HAVING count(*) > 1
),
ranked AS (
  SELECT
    s.*,
    row_number() OVER (
      PARTITION BY s.normalized_name
      ORDER BY
        s.has_mixed_case DESC,
        s.chart_row_count DESC,
        s.track_count DESC,
        s.album_count DESC,
        s.artist_id ASC
    ) AS canonical_rank
  FROM artist_stats s
  JOIN duplicate_groups d ON d.normalized_name = s.normalized_name
),
canonical_pick AS (
  SELECT
    normalized_name,
    artist_id AS suggested_canonical_artist_id,
    artist_name AS suggested_canonical_artist_name
  FROM ranked
  WHERE canonical_rank = 1
)
SELECT
  r.normalized_name AS duplicate_group_key,
  r.artist_id,
  r.artist_name,
  r.normalized_name,
  r.track_count,
  r.album_count,
  r.alias_count,
  r.chart_row_count,
  c.suggested_canonical_artist_id,
  c.suggested_canonical_artist_name,
  CASE
    WHEN r.artist_id = c.suggested_canonical_artist_id THEN
      'canonical candidate'
    WHEN r.artist_name = lower(r.artist_name) THEN
      'duplicate: all-lowercase name'
    WHEN r.artist_name <> lower(r.artist_name)
      AND lower(trim(r.artist_name)) = r.normalized_name THEN
      'duplicate: case/spacing variant'
    ELSE
      'duplicate: normalized name collision (review)'
  END AS reason
FROM ranked r
JOIN canonical_pick c ON c.normalized_name = r.normalized_name
ORDER BY
  r.normalized_name,
  r.artist_id;
