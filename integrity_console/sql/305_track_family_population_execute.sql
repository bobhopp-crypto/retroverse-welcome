-- 305_track_family_population_execute.sql
-- First controlled population: track_families + track_family_members only.
-- Additive, idempotent, no track merges/deletes/chart rewrites.
--
-- Prerequisite: \i integrity_console/sql/301_track_family_schema.sql

BEGIN;

-- Step 1: ensure family rows exist (idempotent)
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
    END AS normalized_family_key
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
  WHERE fk.normalized_family_key IS NOT NULL
    AND fk.normalized_family_key <> ''
),
ranked AS (
  SELECT
    e.*,
    row_number() OVER (
      PARTITION BY e.normalized_family_key
      ORDER BY
        e.chart_row_count DESC,
        (NOT e.has_remaster) DESC,
        (NOT e.has_live) DESC,
        e.title_length ASC,
        e.track_id ASC
    ) AS family_rank
  FROM enriched e
)
INSERT INTO track_families (
  canonical_name,
  canonical_artist_id,
  normalized_family_key
)
SELECT DISTINCT ON (r.normalized_family_key)
  r.original_title,
  r.artist_id,
  r.normalized_family_key
FROM ranked r
WHERE r.family_rank = 1
ORDER BY r.normalized_family_key, r.family_rank
ON CONFLICT (normalized_family_key) DO NOTHING;

-- Step 2: attach members (idempotent)
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
    END AS normalized_family_key
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
  WHERE fk.normalized_family_key IS NOT NULL
    AND fk.normalized_family_key <> ''
),
ranked AS (
  SELECT
    e.*,
    row_number() OVER (
      PARTITION BY e.normalized_family_key
      ORDER BY
        e.chart_row_count DESC,
        (NOT e.has_remaster) DESC,
        (NOT e.has_live) DESC,
        e.title_length ASC,
        e.track_id ASC
    ) AS family_rank,
    count(*) OVER (PARTITION BY e.normalized_family_key) AS member_track_count
  FROM enriched e
),
member_rows AS (
  SELECT
    tf.id AS track_family_id,
    r.track_id,
    CASE
      WHEN r.family_rank = 1 THEN 'primary_recording'
      WHEN r.has_remaster THEN 'remaster_variant'
      WHEN r.has_live THEN 'live_variant'
      WHEN r.has_remix THEN 'remix_variant'
      WHEN r.is_medley THEN 'medley_member'
      ELSE 'variant'
    END AS relationship_type,
    least(100, greatest(0,
      50
      + CASE WHEN r.family_rank = 1 THEN 30 ELSE 0 END
      + CASE WHEN r.chart_row_count > 0 THEN 15 ELSE 0 END
      + CASE WHEN r.member_track_count > 1 THEN 5 ELSE 0 END
    ))::int AS confidence_score,
    (r.family_rank = 1) AS is_primary_recording
  FROM ranked r
  JOIN track_families tf ON tf.normalized_family_key = r.normalized_family_key
)
INSERT INTO track_family_members (
  track_family_id,
  track_id,
  relationship_type,
  confidence_score,
  is_primary_recording
)
SELECT
  mr.track_family_id,
  mr.track_id,
  mr.relationship_type,
  mr.confidence_score,
  mr.is_primary_recording
FROM member_rows mr
ON CONFLICT (track_id) DO NOTHING;

DO $$
DECLARE
  v_families bigint;
  v_members bigint;
  v_inserted_members bigint;
BEGIN
  SELECT count(*) INTO v_families FROM track_families;
  SELECT count(*) INTO v_members FROM track_family_members;
  RAISE NOTICE 'track_families total: %', v_families;
  RAISE NOTICE 'track_family_members total: %', v_members;
END;
$$;

COMMIT;
