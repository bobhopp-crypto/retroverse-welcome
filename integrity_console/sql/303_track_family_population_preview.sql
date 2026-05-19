-- 303_track_family_population_preview.sql
-- Read-only preview of proposed families before population.

WITH normalized AS (
  SELECT
    t.id AS track_id,
    t.artist_id,
    a.canonical_name AS artist_name,
    t.title AS original_title,
    length(t.title) AS title_length,
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
    (t.title ~* 'medley') AS is_medley,
    CASE
      WHEN t.title ~* 'medley' THEN 'medley'
      WHEN t.title ~* 'karaoke' THEN 'karaoke'
      WHEN t.title ~* 'instrumental' THEN 'instrumental'
      WHEN t.title ~* 'remix' THEN 'remix'
      WHEN t.title ~* '\mlive\M' THEN 'live'
      WHEN t.title ~* 'acoustic' THEN 'acoustic'
      WHEN t.title ~* 'extended\s*mix' THEN 'alternate_mix'
      WHEN t.title ~* 'radio\s*edit' THEN 'radio_edit'
      WHEN t.title ~* 'remaster|re-master' THEN 'remaster'
      WHEN t.title ~* '\mmono\M' THEN 'mono'
      WHEN t.title ~* '\mstereo\M' THEN 'stereo'
      WHEN t.title ~* 'explicit' THEN 'explicit'
      WHEN t.title ~* '\mclean\M' THEN 'clean'
      ELSE 'studio'
    END AS detected_variant_type
  FROM tracks t
  LEFT JOIN artists a ON a.id = t.artist_id
  WHERE t.artist_id IS NOT NULL
),
family_keys AS (
  SELECT
    n.*,
    CASE
      WHEN n.is_medley THEN
        n.artist_id::text || '::medley::' || n.normalized_title_basic
      ELSE
        n.artist_id::text || '::' || coalesce(nullif(n.normalized_title_aggressive, ''), n.normalized_title_basic)
    END AS proposed_family_key
  FROM normalized n
),
chart_stats AS (
  SELECT track_id, count(*)::int AS chart_row_count
  FROM chart_appearances
  WHERE track_id IS NOT NULL
  GROUP BY track_id
),
enriched AS (
  SELECT
    fk.*,
    coalesce(cs.chart_row_count, 0) AS chart_row_count
  FROM family_keys fk
  LEFT JOIN chart_stats cs ON cs.track_id = fk.track_id
),
ranked AS (
  SELECT
    e.*,
    row_number() OVER (
      PARTITION BY e.proposed_family_key
      ORDER BY
        e.chart_row_count DESC,
        (e.detected_variant_type = 'studio') DESC,
        (e.detected_variant_type NOT IN ('live', 'remix', 'medley')) DESC,
        e.title_length ASC,
        e.track_id ASC
    ) AS family_rank
  FROM enriched e
),
family_canon AS (
  SELECT proposed_family_key, original_title AS proposed_canonical_name
  FROM ranked
  WHERE family_rank = 1
)
SELECT
  fc.proposed_family_key AS proposed_family,
  fc.proposed_canonical_name,
  r.artist_name,
  r.track_id AS member_track_id,
  r.original_title AS member_track_title,
  r.detected_variant_type,
  r.chart_row_count,
  (r.family_rank = 1) AS is_canonical_candidate,
  CASE
    WHEN r.detected_variant_type IN ('live', 'remix', 'medley', 'karaoke', 'instrumental') THEN
      'preserve_separately'
    WHEN r.detected_variant_type IN ('remaster', 'mono', 'stereo', 'explicit', 'clean', 'radio_edit')
         AND exists (
           SELECT 1 FROM ranked r2
           WHERE r2.proposed_family_key = r.proposed_family_key
             AND r2.detected_variant_type = 'studio'
         ) THEN
      'safe_alias_candidate'
    ELSE
      'review_required'
  END AS preservation_recommendation
FROM ranked r
JOIN family_canon fc ON fc.proposed_family_key = r.proposed_family_key
ORDER BY fc.proposed_family_key, r.family_rank, r.track_id
LIMIT 5000;
