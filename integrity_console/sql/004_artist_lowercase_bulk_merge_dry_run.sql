-- 004_artist_lowercase_bulk_merge_dry_run.sql
-- Preview all safe case/spacing-only bulk merges. Read-only.

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
    SELECT artist_id, count(*)::int AS track_count FROM tracks GROUP BY artist_id
  ) t ON t.artist_id = a.id
  LEFT JOIN (
    SELECT artist_id, count(*)::int AS album_count FROM albums GROUP BY artist_id
  ) al ON al.artist_id = a.id
  LEFT JOIN (
    SELECT artist_id, count(*)::int AS alias_count FROM artist_aliases GROUP BY artist_id
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
group_safety AS (
  SELECT
    s.normalized_name,
    count(*) FILTER (WHERE s.has_mixed_case) AS mixed_case_count,
    count(*) AS member_count
  FROM artist_stats s
  JOIN duplicate_groups d ON d.normalized_name = s.normalized_name
  GROUP BY s.normalized_name
  HAVING
    -- names match after case/spacing normalization only
    count(*) = count(*) FILTER (
      WHERE lower(trim(regexp_replace(s.artist_name, '\s+', ' ', 'g'))) = s.normalized_name
    )
    -- reject groups with multiple proper-case competing names
    AND count(*) FILTER (WHERE s.has_mixed_case) <= 1
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
  JOIN group_safety gs ON gs.normalized_name = s.normalized_name
),
canonical_pick AS (
  SELECT
    normalized_name,
    artist_id AS canonical_artist_id,
    artist_name AS canonical_artist_name
  FROM ranked
  WHERE canonical_rank = 1
),
duplicates AS (
  SELECT r.*
  FROM ranked r
  JOIN canonical_pick c ON c.normalized_name = r.normalized_name
  WHERE r.canonical_rank > 1
)
SELECT
  d.artist_id AS duplicate_artist_id,
  d.artist_name AS duplicate_artist_name,
  c.canonical_artist_id,
  c.canonical_artist_name,
  d.track_count AS affected_tracks,
  d.album_count AS affected_albums,
  d.alias_count AS affected_aliases,
  d.chart_row_count AS affected_chart_rows,
  'high' AS confidence,
  CASE
    WHEN d.artist_name = lower(d.artist_name) THEN
      'safe: all-lowercase duplicate -> mixed-case canonical'
    ELSE
      'safe: case/spacing variant -> canonical'
  END AS reason
FROM duplicates d
JOIN canonical_pick c ON c.normalized_name = d.normalized_name
ORDER BY d.normalized_name, d.artist_id;
