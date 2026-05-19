-- 202_track_duplicate_candidate_groups.sql
-- Likely duplicate track groups (same artist + aggressive normalized title).
-- Read-only. Does NOT merge tracks.

WITH normalized AS (
  SELECT
    t.id AS track_id,
    t.artist_id,
    a.canonical_name AS artist_name,
    t.title AS original_title,
    length(t.title) AS title_length,
    t.duration_seconds,
    lower(trim(regexp_replace(t.title, '\s+', ' ', 'g'))) AS normalized_title_basic,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(trim(regexp_replace(t.title, '\s+', ' ', 'g'))),
                '[''[\](){}]', ' ', 'g'
              ),
              '[–—−]', '-', 'g'
            ),
            '\m(feat\.?|featuring|ft\.?)\M', ' feat ', 'gi'
          ),
          '\s*[-]\s*(remastered?|live|radio edit|mono|stereo|explicit|clean|instrumental|karaoke|acoustic|extended mix|remix).*$',
          '',
          'gi'
        )
      )
    ) AS normalized_title_aggressive,
    (t.title ~* 'remaster|re-master') AS has_remaster,
    (t.title ~* '\mlive\M') AS has_live,
    (t.title ~* 'remix') AS has_remix,
    (t.title ~* 'medley') AS has_medley
  FROM tracks t
  LEFT JOIN artists a ON a.id = t.artist_id
  WHERE t.artist_id IS NOT NULL
    AND t.title !~* 'medley'
),
chart_stats AS (
  SELECT
    track_id,
    count(*)::int AS chart_row_count,
    count(DISTINCT chart_name)::int AS chart_name_count
  FROM chart_appearances
  WHERE track_id IS NOT NULL
  GROUP BY track_id
),
enriched AS (
  SELECT
    n.*,
    coalesce(cs.chart_row_count, 0) AS chart_row_count,
    coalesce(cs.chart_name_count, 0) AS chart_name_count
  FROM normalized n
  LEFT JOIN chart_stats cs ON cs.track_id = n.track_id
),
duplicate_groups AS (
  SELECT
    artist_id,
    normalized_title_aggressive,
    count(*) AS candidate_count
  FROM enriched
  WHERE normalized_title_aggressive <> ''
  GROUP BY artist_id, normalized_title_aggressive
  HAVING count(*) > 1
),
ranked AS (
  SELECT
    e.*,
    (e.artist_id::text || '::' || e.normalized_title_aggressive) AS duplicate_group_key,
    row_number() OVER (
      PARTITION BY e.artist_id, e.normalized_title_aggressive
      ORDER BY
        (NOT (e.has_live OR e.has_remix OR e.has_remaster)) DESC,
        e.chart_row_count DESC,
        e.title_length ASC,
        e.track_id ASC
    ) AS canonical_rank
  FROM enriched e
  JOIN duplicate_groups d
    ON d.artist_id = e.artist_id
   AND d.normalized_title_aggressive = e.normalized_title_aggressive
),
pairs AS (
  SELECT
    r.duplicate_group_key,
    d.candidate_count,
    canon.track_id AS canonical_track_candidate_id,
    canon.original_title AS canonical_track_candidate_name,
    r.track_id AS duplicate_track_id,
    r.original_title AS duplicate_track_name,
    r.normalized_title_basic AS duplicate_normalized_basic,
    canon.normalized_title_basic AS canonical_normalized_basic,
    r.has_remaster,
    r.has_live,
    r.has_remix,
    r.chart_row_count,
    canon.chart_row_count AS canonical_chart_rows,
    r.duration_seconds,
    canon.duration_seconds AS canonical_duration_seconds
  FROM ranked r
  JOIN duplicate_groups d
    ON d.artist_id = r.artist_id
   AND d.normalized_title_aggressive = r.normalized_title_aggressive
  JOIN ranked canon
    ON canon.duplicate_group_key = r.duplicate_group_key
   AND canon.canonical_rank = 1
  WHERE r.canonical_rank > 1
)
SELECT
  duplicate_group_key,
  candidate_count,
  canonical_track_candidate_id,
  canonical_track_candidate_name,
  duplicate_track_id,
  duplicate_track_name,
  least(100, greatest(0,
    (
      CASE
        WHEN duplicate_normalized_basic = canonical_normalized_basic THEN 35
        WHEN has_remaster THEN 20
        ELSE 25
      END
      + CASE
          WHEN chart_row_count > 0 AND canonical_chart_rows > 0 THEN 30
          WHEN chart_row_count > 0 OR canonical_chart_rows > 0 THEN 15
          ELSE 0
        END
      + CASE
          WHEN has_live OR has_remix THEN -15
          WHEN has_remaster THEN -5
          ELSE 10
        END
      + CASE
          WHEN duration_seconds IS NOT NULL
           AND canonical_duration_seconds IS NOT NULL
           AND abs(duration_seconds - canonical_duration_seconds) <= 10 THEN 15
          WHEN duration_seconds IS NOT NULL
           AND canonical_duration_seconds IS NOT NULL
           AND abs(duration_seconds - canonical_duration_seconds)::numeric
               / nullif(greatest(duration_seconds, canonical_duration_seconds), 0) <= 0.05 THEN 10
          ELSE 0
        END
    )
  ))::int AS confidence_score,
  concat_ws(
    '; ',
    CASE
      WHEN duplicate_normalized_basic = canonical_normalized_basic THEN
        'HIGH: exact normalized basic title'
      ELSE
        'MEDIUM: punctuation/whitespace/remaster variant'
    END,
    CASE
      WHEN chart_row_count > 0 AND canonical_chart_rows > 0 THEN
        'HIGH: both tracks have chart lineage'
      WHEN chart_row_count > 0 OR canonical_chart_rows > 0 THEN
        'MEDIUM: partial chart lineage'
      ELSE
        'no shared chart signal'
    END,
    CASE
      WHEN has_live THEN 'LOWER: live variant'
      WHEN has_remix THEN 'LOWER: remix variant'
      WHEN has_remaster THEN 'MEDIUM: remaster variant'
      ELSE 'studio-like variant'
    END,
    CASE
      WHEN duration_seconds IS NOT NULL
       AND canonical_duration_seconds IS NOT NULL
       AND abs(duration_seconds - canonical_duration_seconds) <= 10 THEN
        'runtime within 10s'
      ELSE
        'runtime not compared or differs'
    END
  ) AS confidence_reason
FROM pairs
ORDER BY confidence_score DESC, duplicate_group_key, duplicate_track_id;
