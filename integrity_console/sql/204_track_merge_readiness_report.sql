-- 204_track_merge_readiness_report.sql
-- Merge readiness summary for future track canonical operations. Read-only.
-- Returns two result sets: summary metrics, then top 100 groups.

WITH normalized AS (
  SELECT
    t.id AS track_id,
    t.artist_id,
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
),
chart_stats AS (
  SELECT track_id, count(*)::int AS chart_row_count
  FROM chart_appearances
  WHERE track_id IS NOT NULL
  GROUP BY track_id
),
enriched AS (
  SELECT
    n.*,
    coalesce(cs.chart_row_count, 0) AS chart_row_count
  FROM normalized n
  LEFT JOIN chart_stats cs ON cs.track_id = n.track_id
),
groups AS (
  SELECT
    artist_id,
    normalized_title_aggressive,
    count(*) AS member_count,
    bool_or(has_medley) AS group_has_medley,
    bool_or(has_live) AS group_has_live,
    bool_or(has_remix) AS group_has_remix,
    bool_or(has_remaster) AS group_has_remaster,
    count(*) FILTER (WHERE chart_row_count > 0) AS charted_member_count
  FROM enriched
  WHERE artist_id IS NOT NULL
    AND normalized_title_aggressive <> ''
  GROUP BY artist_id, normalized_title_aggressive
  HAVING count(*) > 1
),
classified_groups AS (
  SELECT
    g.*,
    (g.artist_id::text || '::' || g.normalized_title_aggressive) AS duplicate_group_key,
    CASE
      WHEN g.group_has_medley THEN 'dangerous'
      WHEN g.group_has_live OR g.group_has_remix THEN 'version_variant'
      WHEN g.charted_member_count > 1 THEN 'high_confidence'
      WHEN g.group_has_remaster THEN 'review_required'
      ELSE 'likely_safe_duplicate'
    END AS readiness_bucket,
    least(100, greatest(0,
      30
      + CASE WHEN g.charted_member_count > 1 THEN 30 ELSE 0 END
      + CASE WHEN NOT (g.group_has_live OR g.group_has_remix) THEN 20 ELSE -10 END
      + CASE WHEN g.group_has_remaster THEN -5 ELSE 10 END
    ))::int AS group_confidence_score
  FROM groups g
)
SELECT
  'SUMMARY' AS section,
  metric_name,
  metric_value::text AS metric_value
FROM (
  SELECT 'total_tracks' AS metric_name, count(*)::bigint AS metric_value FROM tracks
  UNION ALL
  SELECT 'duplicate_groups', count(*) FROM classified_groups
  UNION ALL
  SELECT 'likely_safe_duplicates', count(*) FROM classified_groups WHERE readiness_bucket = 'likely_safe_duplicate'
  UNION ALL
  SELECT 'likely_version_variants', count(*) FROM classified_groups WHERE readiness_bucket = 'version_variant'
  UNION ALL
  SELECT 'high_confidence_merge_groups', count(*) FROM classified_groups WHERE readiness_bucket = 'high_confidence'
  UNION ALL
  SELECT 'review_required_groups', count(*) FROM classified_groups WHERE readiness_bucket = 'review_required'
  UNION ALL
  SELECT 'dangerous_groups', count(*) FROM classified_groups WHERE readiness_bucket = 'dangerous'
  UNION ALL
  SELECT 'tracks_in_duplicate_groups', coalesce(sum(member_count), 0)::bigint FROM classified_groups
) metrics
ORDER BY metric_name;

WITH normalized AS (
  SELECT
    t.id AS track_id,
    t.artist_id,
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
),
chart_stats AS (
  SELECT track_id, count(*)::int AS chart_row_count
  FROM chart_appearances
  WHERE track_id IS NOT NULL
  GROUP BY track_id
),
enriched AS (
  SELECT
    n.*,
    coalesce(cs.chart_row_count, 0) AS chart_row_count
  FROM normalized n
  LEFT JOIN chart_stats cs ON cs.track_id = n.track_id
),
groups AS (
  SELECT
    artist_id,
    normalized_title_aggressive,
    count(*) AS member_count,
    bool_or(has_medley) AS group_has_medley,
    bool_or(has_live) AS group_has_live,
    bool_or(has_remix) AS group_has_remix,
    bool_or(has_remaster) AS group_has_remaster,
    count(*) FILTER (WHERE chart_row_count > 0) AS charted_member_count
  FROM enriched
  WHERE artist_id IS NOT NULL
    AND normalized_title_aggressive <> ''
  GROUP BY artist_id, normalized_title_aggressive
  HAVING count(*) > 1
),
classified_groups AS (
  SELECT
    g.*,
    (g.artist_id::text || '::' || g.normalized_title_aggressive) AS duplicate_group_key,
    CASE
      WHEN g.group_has_medley THEN 'dangerous'
      WHEN g.group_has_live OR g.group_has_remix THEN 'version_variant'
      WHEN g.charted_member_count > 1 THEN 'high_confidence'
      WHEN g.group_has_remaster THEN 'review_required'
      ELSE 'likely_safe_duplicate'
    END AS readiness_bucket,
    least(100, greatest(0,
      30
      + CASE WHEN g.charted_member_count > 1 THEN 30 ELSE 0 END
      + CASE WHEN NOT (g.group_has_live OR g.group_has_remix) THEN 20 ELSE -10 END
      + CASE WHEN g.group_has_remaster THEN -5 ELSE 10 END
    ))::int AS group_confidence_score
  FROM groups g
)
SELECT
  'TOP_GROUP' AS section,
  duplicate_group_key AS metric_name,
  group_confidence_score::text AS metric_value,
  readiness_bucket || ' | members=' || member_count AS detail
FROM classified_groups
ORDER BY group_confidence_score DESC, member_count DESC, duplicate_group_key
LIMIT 100;
