-- 302_track_family_candidate_generation.sql
-- Proposed canonical track families. Read-only.

WITH normalized AS (
  SELECT
    t.id AS track_id,
    t.artist_id,
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
    (t.title ~* 'remaster|re-master') AS has_remaster,
    (t.title ~* '\mlive\M') AS has_live,
    (t.title ~* 'remix') AS has_remix
  FROM tracks t
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
family_groups AS (
  SELECT
    proposed_family_key,
    min(artist_id) AS canonical_artist_id,
    count(*) AS member_track_count
  FROM enriched
  WHERE proposed_family_key IS NOT NULL
    AND proposed_family_key <> ''
  GROUP BY proposed_family_key
),
ranked AS (
  SELECT
    e.*,
    fg.member_track_count,
    row_number() OVER (
      PARTITION BY e.proposed_family_key
      ORDER BY
        e.chart_row_count DESC,
        (NOT e.has_remaster) DESC,
        (NOT e.has_live) DESC,
        e.title_length ASC,
        e.track_id ASC
    ) AS family_rank
  FROM enriched e
  JOIN family_groups fg ON fg.proposed_family_key = e.proposed_family_key
)
SELECT
  fg.proposed_family_key,
  canon.original_title AS canonical_name,
  fg.proposed_family_key AS normalized_family_key,
  fg.canonical_artist_id,
  fg.member_track_count,
  canon.track_id AS canonical_track_candidate_id,
  least(100, greatest(0,
    40
    + CASE WHEN fg.member_track_count > 1 THEN 25 ELSE 10 END
    + CASE WHEN canon.chart_row_count > 0 THEN 20 ELSE 0 END
    + CASE WHEN NOT canon.has_live AND NOT canon.has_remix THEN 15 ELSE 0 END
  ))::int AS confidence
FROM family_groups fg
JOIN ranked canon
  ON canon.proposed_family_key = fg.proposed_family_key
 AND canon.family_rank = 1
ORDER BY fg.member_track_count DESC, fg.proposed_family_key;
