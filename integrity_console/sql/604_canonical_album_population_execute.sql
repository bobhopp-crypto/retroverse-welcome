-- 604_canonical_album_population_execute.sql
-- First controlled canonical album population from Billboard 200 staging.
-- Additive, idempotent. Does not merge or delete.

BEGIN;

CREATE TABLE IF NOT EXISTS album_population_registry (
  proposed_album_key    text PRIMARY KEY,
  album_id              bigint NOT NULL REFERENCES albums(id),
  canonical_artist_id   bigint REFERENCES artists(id),
  source_name           text NOT NULL DEFAULT 'billboard_200_sqlite',
  canonical_album_name  text NOT NULL,
  staging_row_count     integer,
  first_chart_date      date,
  last_chart_date       date,
  created_at            timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_album_population_registry_album
  ON album_population_registry (album_id);

CREATE TEMP TABLE tmp_staging_keys ON COMMIT DROP AS
WITH staging_norm AS (
  SELECT
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
with_artist AS (
  SELECT sn.*, a.id AS canonical_artist_id
  FROM staging_norm sn
  LEFT JOIN LATERAL (
    SELECT id FROM artists
    WHERE lower(trim(canonical_name)) = lower(trim(sn.source_artist))
    ORDER BY id LIMIT 1
  ) a ON true
)
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
WHERE wa.canonical_artist_id IS NOT NULL;

CREATE TEMP TABLE tmp_album_candidates ON COMMIT DROP AS
WITH grouped AS (
  SELECT
    proposed_album_key,
    min(canonical_artist_id) AS canonical_artist_id,
    count(*)::int AS staging_row_count,
    min(chart_date) AS first_chart_date,
    max(chart_date) AS last_chart_date
  FROM tmp_staging_keys
  WHERE proposed_album_key IS NOT NULL
  GROUP BY proposed_album_key
),
ranked_title AS (
  SELECT
    sk.proposed_album_key,
    sk.source_album,
    sk.is_deluxe,
    sk.has_remaster,
    sk.has_live,
    row_number() OVER (
      PARTITION BY sk.proposed_album_key
      ORDER BY
        count(*) DESC,
        min(sk.chart_date) ASC,
        (NOT sk.is_deluxe) DESC,
        (NOT sk.has_remaster) DESC,
        (NOT sk.has_live) DESC,
        length(sk.source_album) ASC
    ) AS rn
  FROM tmp_staging_keys sk
  GROUP BY sk.proposed_album_key, sk.source_album, sk.is_deluxe, sk.has_remaster, sk.has_live
)
SELECT
  g.proposed_album_key,
  g.canonical_artist_id,
  rt.source_album AS canonical_album_name,
  extract(year FROM g.first_chart_date)::int AS release_year,
  g.staging_row_count,
  g.first_chart_date,
  g.last_chart_date
FROM grouped g
JOIN ranked_title rt ON rt.proposed_album_key = g.proposed_album_key AND rt.rn = 1;

WITH to_insert AS (
  SELECT c.*
  FROM tmp_album_candidates c
  WHERE NOT EXISTS (
    SELECT 1 FROM album_population_registry r WHERE r.proposed_album_key = c.proposed_album_key
  )
  AND NOT EXISTS (
    SELECT 1 FROM albums al
    WHERE al.artist_id = c.canonical_artist_id
      AND lower(trim(al.title)) = lower(trim(c.canonical_album_name))
  )
),
new_albums AS (
  INSERT INTO albums (artist_id, title, release_year)
  SELECT canonical_artist_id, canonical_album_name, release_year
  FROM to_insert
  RETURNING id, artist_id, title
)
INSERT INTO album_population_registry (
  proposed_album_key,
  album_id,
  canonical_artist_id,
  canonical_album_name,
  staging_row_count,
  first_chart_date,
  last_chart_date
)
SELECT
  t.proposed_album_key,
  na.id,
  t.canonical_artist_id,
  t.canonical_album_name,
  t.staging_row_count,
  t.first_chart_date,
  t.last_chart_date
FROM to_insert t
JOIN new_albums na
  ON na.artist_id = t.canonical_artist_id
 AND lower(trim(na.title)) = lower(trim(t.canonical_album_name));

-- Backfill registry for pre-existing albums (one album per key; prefer lowest id)
INSERT INTO album_population_registry (
  proposed_album_key,
  album_id,
  canonical_artist_id,
  canonical_album_name,
  staging_row_count,
  first_chart_date,
  last_chart_date
)
SELECT DISTINCT ON (c.proposed_album_key)
  c.proposed_album_key,
  al.id,
  c.canonical_artist_id,
  c.canonical_album_name,
  c.staging_row_count,
  c.first_chart_date,
  c.last_chart_date
FROM tmp_album_candidates c
JOIN albums al
  ON al.artist_id = c.canonical_artist_id
 AND lower(trim(al.title)) = lower(trim(c.canonical_album_name))
WHERE NOT EXISTS (
  SELECT 1 FROM album_population_registry r WHERE r.proposed_album_key = c.proposed_album_key
)
ORDER BY c.proposed_album_key, al.id;

INSERT INTO album_editions (album_id, edition_name, release_year, is_canonical)
SELECT
  r.album_id,
  sk.source_album,
  extract(year FROM min(sk.chart_date))::int,
  lower(trim(sk.source_album)) = lower(trim(r.canonical_album_name))
FROM tmp_staging_keys sk
JOIN album_population_registry r ON r.proposed_album_key = sk.proposed_album_key
WHERE NOT EXISTS (
  SELECT 1 FROM album_editions ae
  WHERE ae.album_id = r.album_id
    AND lower(trim(ae.edition_name)) = lower(trim(sk.source_album))
)
GROUP BY r.album_id, sk.source_album, r.canonical_album_name;

COMMIT;

SELECT
  (SELECT count(*) FROM album_population_registry) AS registry_albums,
  (SELECT count(*) FROM albums) AS total_albums,
  (SELECT count(*) FROM album_editions) AS total_editions;
