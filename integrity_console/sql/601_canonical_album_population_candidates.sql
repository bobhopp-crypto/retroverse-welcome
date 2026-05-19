-- 601_canonical_album_population_candidates.sql
-- Canonical album candidates from Billboard 200 staging. Read-only.

WITH staging_norm AS (
  SELECT
    s.id AS staging_row_id,
    s.source_artist,
    s.source_album,
    s.chart_date,
    s.chart_position,
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
    a.canonical_name AS canonical_artist_name,
    (ad.artist_key IS NOT NULL) AS artist_name_ambiguous
  FROM staging_norm sn
  LEFT JOIN LATERAL (
    SELECT id, canonical_name
    FROM artists
    WHERE lower(trim(canonical_name)) = lower(trim(sn.source_artist))
    ORDER BY id
    LIMIT 1
  ) a ON true
  LEFT JOIN artist_name_dupes ad
    ON ad.artist_key = lower(trim(sn.source_artist))
),
with_keys AS (
  SELECT
    wa.*,
    CASE
      WHEN wa.canonical_artist_id IS NULL THEN
        'unresolved::' || lower(trim(wa.source_artist)) || '::' ||
        CASE
          WHEN wa.is_soundtrack THEN 'soundtrack::' || wa.normalized_title_basic
          WHEN wa.is_compilation THEN 'compilation::' || wa.normalized_title_basic
          WHEN wa.has_live THEN 'live::' || wa.normalized_title_basic
          ELSE coalesce(nullif(wa.normalized_base_title, ''), wa.normalized_title_basic)
        END
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
grouped AS (
  SELECT
    proposed_album_key,
    min(canonical_artist_id) AS canonical_artist_id,
    min(canonical_artist_name) AS canonical_artist_name,
    count(*)::int AS staging_row_count,
    count(DISTINCT source_album)::int AS distinct_source_titles,
    min(chart_date) AS first_chart_date,
    max(chart_date) AS last_chart_date,
    min(chart_position) AS peak_position,
    bool_or(is_soundtrack) AS is_soundtrack,
    bool_or(is_compilation) AS is_compilation
  FROM with_keys
  GROUP BY proposed_album_key
),
ranked_titles AS (
  SELECT
    wk.proposed_album_key,
    wk.source_album,
    wk.is_deluxe,
    wk.has_remaster,
    wk.has_live,
    count(*)::int AS title_row_count,
    min(wk.chart_date) AS title_first_chart,
    row_number() OVER (
      PARTITION BY wk.proposed_album_key
      ORDER BY
        count(*) DESC,
        min(wk.chart_date) ASC,
        (NOT wk.is_deluxe) DESC,
        (NOT wk.has_remaster) DESC,
        (NOT wk.has_live) DESC,
        length(wk.source_album) ASC
    ) AS title_rank
  FROM with_keys wk
  GROUP BY wk.proposed_album_key, wk.source_album, wk.is_deluxe, wk.has_remaster, wk.has_live
)
SELECT
  g.proposed_album_key,
  rt.source_album AS canonical_album_name,
  g.canonical_artist_id,
  g.canonical_artist_name,
  g.staging_row_count,
  g.distinct_source_titles,
  g.first_chart_date,
  g.last_chart_date,
  g.peak_position,
  least(100, greatest(0,
    (CASE WHEN g.canonical_artist_id IS NOT NULL THEN 40 ELSE 0 END)
    + (CASE WHEN g.staging_row_count >= 20 THEN 25 WHEN g.staging_row_count >= 4 THEN 15 ELSE 5 END)
    + (CASE WHEN g.is_soundtrack OR g.is_compilation THEN 10 ELSE 15 END)
  ))::int AS confidence,
  CASE
    WHEN g.canonical_artist_id IS NULL THEN 'review_artist'
    WHEN EXISTS (
      SELECT 1 FROM with_keys wk
      WHERE wk.proposed_album_key = g.proposed_album_key
        AND wk.artist_name_ambiguous
    ) THEN 'review_artist_ambiguous'
    WHEN g.distinct_source_titles > 8 THEN 'review_many_editions'
    ELSE 'ok'
  END AS review_flag
FROM grouped g
JOIN ranked_titles rt
  ON rt.proposed_album_key = g.proposed_album_key
 AND rt.title_rank = 1
ORDER BY g.staging_row_count DESC, g.proposed_album_key
LIMIT 10000;
