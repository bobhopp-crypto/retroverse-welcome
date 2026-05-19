-- 605_album_chart_linkage_population.sql
-- Billboard 200 chart lineage via album_population_registry (Phase 6).
-- Additive only. Does not modify Hot 100 rows or delete staging.

BEGIN;

WITH staging_norm AS (
  SELECT
    s.id AS staging_row_id,
    s.source_artist,
    s.source_album,
    s.chart_date,
    s.chart_position,
    s.weeks_on_chart,
    lower(trim(regexp_replace(s.source_album, '\s+', ' ', 'g'))) AS normalized_title_basic,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(trim(regexp_replace(s.source_album, '\s+', ' ', 'g'))),
                '[''[\](){}]', ' ', 'g'
              ),
              '[–—−]', '-', 'g'
            ),
            '\s*[-]\s*(remastered?|deluxe|expanded|anniversary|special edition|live|bonus).*$',
            '',
            'gi'
          ),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS normalized_base_title,
    (s.source_album ~* 'soundtrack') AS is_soundtrack,
    (s.source_album ~* 'compilation|greatest hits|best of') AS is_compilation,
    (s.source_album ~* 'deluxe|expanded|anniversary|special edition') AS is_deluxe,
    (s.source_album ~* 'remaster|re-master') AS has_remaster,
    (s.source_album ~* '\mlive\M') AS has_live
  FROM staging_billboard_200_weekly s
),
artist_name_dupes AS (
  SELECT lower(trim(canonical_name)) AS artist_key
  FROM artists
  GROUP BY lower(trim(canonical_name))
  HAVING count(*) > 1
),
with_artist AS (
  SELECT
    sn.*,
    a.id AS canonical_artist_id,
    (ad.artist_key IS NOT NULL) AS artist_name_ambiguous
  FROM staging_norm sn
  LEFT JOIN LATERAL (
    SELECT id FROM artists
    WHERE lower(trim(canonical_name)) = lower(trim(sn.source_artist))
    ORDER BY id LIMIT 1
  ) a ON true
  LEFT JOIN artist_name_dupes ad
    ON ad.artist_key = lower(trim(sn.source_artist))
),
with_keys AS (
  SELECT
    wa.*,
    CASE
      WHEN wa.canonical_artist_id IS NULL THEN NULL
      ELSE
        wa.canonical_artist_id::text || '::' ||
        CASE
          WHEN wa.is_soundtrack THEN 'soundtrack::' || wa.normalized_title_basic
          WHEN wa.is_compilation THEN 'compilation::' || wa.normalized_title_basic
          WHEN wa.has_live THEN 'live::' || wa.normalized_title_basic
          ELSE coalesce(nullif(wa.normalized_base_title, ''), wa.normalized_title_basic)
        END
    END AS proposed_album_key
  FROM with_artist wa
),
group_flags AS (
  SELECT
    proposed_album_key,
    count(DISTINCT source_album)::int AS distinct_source_titles,
    bool_or(artist_name_ambiguous) AS artist_ambiguous
  FROM with_keys
  WHERE proposed_album_key IS NOT NULL
  GROUP BY proposed_album_key
)
INSERT INTO album_chart_linkage_candidates (
  staging_row_id,
  resolved_artist_id,
  resolved_album_id,
  match_method,
  confidence_score,
  review_flag
)
SELECT
  wk.staging_row_id,
  coalesce(r.canonical_artist_id, wk.canonical_artist_id),
  r.album_id,
  CASE
    WHEN r.album_id IS NOT NULL THEN 'registry_proposed_key'
    WHEN wk.canonical_artist_id IS NOT NULL THEN 'artist_only_registry_miss'
    ELSE 'unresolved'
  END,
  CASE
    WHEN r.album_id IS NOT NULL THEN 95
    WHEN wk.canonical_artist_id IS NOT NULL THEN 55
    ELSE 20
  END,
  CASE
    WHEN wk.canonical_artist_id IS NULL THEN 'review_artist'
    WHEN gf.artist_ambiguous THEN 'review_artist_ambiguous'
    WHEN r.album_id IS NULL THEN 'review_album'
    WHEN gf.distinct_source_titles > 8 THEN 'review_many_editions'
    WHEN r.album_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM albums al2
      WHERE al2.artist_id = r.canonical_artist_id
        AND al2.id <> r.album_id
        AND lower(trim(al2.title)) = lower(trim(r.canonical_album_name))
    ) THEN 'review_duplicate_album'
    ELSE 'ok'
  END
FROM with_keys wk
LEFT JOIN album_population_registry r ON r.proposed_album_key = wk.proposed_album_key
LEFT JOIN group_flags gf ON gf.proposed_album_key = wk.proposed_album_key
ON CONFLICT (staging_row_id) DO UPDATE SET
  resolved_artist_id = EXCLUDED.resolved_artist_id,
  resolved_album_id = EXCLUDED.resolved_album_id,
  match_method = EXCLUDED.match_method,
  confidence_score = EXCLUDED.confidence_score,
  review_flag = EXCLUDED.review_flag;

INSERT INTO chart_appearances (
  album_id,
  chart_date,
  chart_name,
  chart_position,
  weeks_on_chart
)
SELECT
  c.resolved_album_id,
  s.chart_date,
  'Billboard 200',
  s.chart_position,
  s.weeks_on_chart
FROM album_chart_linkage_candidates c
JOIN staging_billboard_200_weekly s ON s.id = c.staging_row_id
WHERE c.resolved_album_id IS NOT NULL
  AND c.review_flag = 'ok'
  AND c.confidence_score >= 85
  AND NOT EXISTS (
    SELECT 1
    FROM chart_appearances ca
    WHERE ca.album_id = c.resolved_album_id
      AND ca.chart_date = s.chart_date
      AND ca.chart_name = 'Billboard 200'
  );

UPDATE album_chart_linkage_candidates c
SET chart_inserted = true
FROM staging_billboard_200_weekly s
WHERE s.id = c.staging_row_id
  AND c.resolved_album_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM chart_appearances ca
    WHERE ca.album_id = c.resolved_album_id
      AND ca.chart_date = s.chart_date
      AND ca.chart_name = 'Billboard 200'
  );

COMMIT;

SELECT review_flag, count(*) AS row_count
FROM album_chart_linkage_candidates
GROUP BY review_flag
ORDER BY row_count DESC;
