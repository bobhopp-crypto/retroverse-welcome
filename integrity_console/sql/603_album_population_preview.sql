-- 603_album_population_preview.sql
-- Read-only preview of canonical album population. No mutations.

WITH candidates AS (
  SELECT
    proposed_album_key,
    canonical_album_name,
    canonical_artist_id,
    canonical_artist_name,
    staging_row_count,
    first_chart_date,
    last_chart_date,
    peak_position,
    confidence,
    review_flag
  FROM (
    SELECT * FROM (
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
          (s.source_album ~* 'compilation|greatest hits|best of') AS is_compilation
        FROM staging_billboard_200_weekly s
      ),
      with_artist AS (
        SELECT
          sn.*,
          a.id AS canonical_artist_id,
          a.canonical_name AS canonical_artist_name
        FROM staging_norm sn
        LEFT JOIN LATERAL (
          SELECT id, canonical_name FROM artists
          WHERE lower(trim(canonical_name)) = lower(trim(sn.source_artist))
          ORDER BY id LIMIT 1
        ) a ON true
      ),
      with_keys AS (
        SELECT
          wa.*,
          CASE
            WHEN wa.canonical_artist_id IS NULL THEN
              'unresolved::' || lower(trim(wa.source_artist)) || '::' ||
              coalesce(nullif(wa.normalized_base_title, ''), wa.normalized_title_basic)
            ELSE
              wa.canonical_artist_id::text || '::' ||
              coalesce(nullif(wa.normalized_base_title, ''), wa.normalized_title_basic)
          END AS proposed_album_key
        FROM with_artist wa
      ),
      grouped AS (
        SELECT
          proposed_album_key,
          min(canonical_artist_id) AS canonical_artist_id,
          min(canonical_artist_name) AS canonical_artist_name,
          count(*)::int AS staging_row_count,
          min(chart_date) AS first_chart_date,
          max(chart_date) AS last_chart_date,
          min(chart_position) AS peak_position
        FROM with_keys
        GROUP BY proposed_album_key
      ),
      ranked_titles AS (
        SELECT
          wk.proposed_album_key,
          wk.source_album,
          row_number() OVER (
            PARTITION BY wk.proposed_album_key
            ORDER BY count(*) DESC, min(wk.chart_date) ASC, length(wk.source_album) ASC
          ) AS title_rank
        FROM with_keys wk
        GROUP BY wk.proposed_album_key, wk.source_album
      )
      SELECT
        g.proposed_album_key,
        rt.source_album AS canonical_album_name,
        g.canonical_artist_id,
        g.canonical_artist_name,
        g.staging_row_count,
        g.first_chart_date,
        g.last_chart_date,
        g.peak_position,
        75 AS confidence,
        CASE WHEN g.canonical_artist_id IS NULL THEN 'review_artist' ELSE 'ok' END AS review_flag
      FROM grouped g
      JOIN ranked_titles rt
        ON rt.proposed_album_key = g.proposed_album_key AND rt.title_rank = 1
    ) sub
  ) c
),
edition_counts AS (
  SELECT
    proposed_album_key,
    count(DISTINCT source_album)::int AS edition_variant_count
  FROM (
    SELECT
      CASE
        WHEN a.id IS NULL THEN 'unresolved::' || lower(trim(s.source_artist)) || '::' || lower(trim(s.source_album))
        ELSE a.id::text || '::' || lower(trim(regexp_replace(s.source_album, '\s+', ' ', 'g')))
      END AS proposed_album_key,
      s.source_album
    FROM staging_billboard_200_weekly s
    LEFT JOIN LATERAL (
      SELECT id FROM artists
      WHERE lower(trim(canonical_name)) = lower(trim(s.source_artist))
      ORDER BY id LIMIT 1
    ) a ON true
  ) x
  GROUP BY proposed_album_key
)
SELECT
  c.proposed_album_key,
  c.canonical_album_name,
  c.canonical_artist_name,
  c.canonical_artist_id,
  c.staging_row_count,
  coalesce(ec.edition_variant_count, 1) AS probable_editions,
  c.peak_position AS chart_peak,
  c.staging_row_count AS weeks_on_chart_proxy,
  c.first_chart_date,
  c.last_chart_date,
  c.confidence,
  c.review_flag
FROM candidates c
LEFT JOIN edition_counts ec ON ec.proposed_album_key = c.proposed_album_key
ORDER BY c.staging_row_count DESC
LIMIT 5000;
