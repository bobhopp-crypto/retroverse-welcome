-- 1102_populate_canonical_album_tracks.sql
-- Load canonical_album_tracks from staging CSV (export_canonical_album_tracks_staging.py).
--
-- Prerequisite: 1101, album_external_keys, staging_acoustic_tracks
--   python3 scripts/export_canonical_album_tracks_staging.py
--   psql -U bobhopp -d retroverse -c "\copy staging_canonical_album_track_imports (
--     external_key, position, title, canonical_source, confidence_score,
--     musicbrainz_position, acoustic_staging_id, review_flag
--   ) FROM 'exports/graph/canonical_album_tracks_staging.csv' CSV HEADER"
--
-- Idempotent: upserts by (album_id, position).

BEGIN;

-- Refresh graph rows for albums present in staging (load CSV before this script).
DELETE FROM canonical_album_tracks cat
USING album_external_keys aek, staging_canonical_album_track_imports st
WHERE cat.album_id = aek.album_id
  AND upper(trim(aek.external_key)) = upper(trim(st.external_key));

INSERT INTO canonical_album_tracks (
  album_id,
  album_edition_id,
  track_id,
  track_family_id,
  position,
  title,
  duration_seconds,
  acoustic_source_id,
  musicbrainz_position,
  canonical_source,
  confidence_score,
  review_flag,
  updated_at
)
SELECT
  aek.album_id,
  (
    SELECT ae.id FROM album_editions ae
    WHERE ae.album_id = aek.album_id AND ae.is_canonical
    ORDER BY ae.id LIMIT 1
  ),
  NULL::bigint,
  NULL::bigint,
  st.position,
  trim(st.title),
  CASE
    WHEN sat.source_duration IS NOT NULL AND sat.source_duration > 0
      THEN round(sat.source_duration::numeric / 1000.0, 3)
    ELSE NULL
  END,
  NULLIF(trim(st.acoustic_staging_id), '')::bigint,
  st.musicbrainz_position,
  st.canonical_source,
  coalesce(st.confidence_score, 0.9),
  coalesce(nullif(trim(st.review_flag), ''), 'ok'),
  now()
FROM (
  SELECT DISTINCT ON (aek.album_id, st.position)
    aek.album_id,
    st.position,
    st.title,
    st.canonical_source,
    st.confidence_score,
    st.musicbrainz_position,
    st.acoustic_staging_id,
    st.review_flag
  FROM staging_canonical_album_track_imports st
  JOIN album_external_keys aek
    ON upper(trim(aek.external_key)) = upper(trim(st.external_key))
  ORDER BY aek.album_id, st.position, st.confidence_score DESC NULLS LAST, st.title
) st
JOIN album_external_keys aek ON aek.album_id = st.album_id
LEFT JOIN staging_acoustic_tracks sat
  ON sat.id = NULLIF(trim(st.acoustic_staging_id), '')::bigint
ON CONFLICT (album_id, position) DO UPDATE SET
  title = EXCLUDED.title,
  duration_seconds = EXCLUDED.duration_seconds,
  acoustic_source_id = EXCLUDED.acoustic_source_id,
  musicbrainz_position = EXCLUDED.musicbrainz_position,
  canonical_source = EXCLUDED.canonical_source,
  confidence_score = EXCLUDED.confidence_score,
  review_flag = EXCLUDED.review_flag,
  album_edition_id = COALESCE(EXCLUDED.album_edition_id, canonical_album_tracks.album_edition_id),
  updated_at = now();

-- Fallback: albums with ≥6 clean acoustic stems but no canonical rows yet
WITH clean_acoustic AS (
  SELECT
    c.album_id,
    sat.id AS acoustic_id,
    sat.source_song,
    sat.source_duration,
    sat.source_release_year,
    row_number() OVER (
      PARTITION BY c.album_id, lower(trim(regexp_replace(sat.source_song, '\s+-\s+.*$', '', 'i')))
      ORDER BY
        CASE WHEN sat.source_song ~* '\b(2008|25th|anniversary|interview|remix|demo|bonus|deluxe)\b' THEN 1 ELSE 0 END,
        coalesce(sat.source_release_year, 9999),
        length(sat.source_song),
        sat.id
    ) AS rn
  FROM acoustic_track_album_candidates c
  JOIN staging_acoustic_tracks sat ON sat.id = c.staging_acoustic_id
  WHERE c.album_id IS NOT NULL
    AND c.review_flag IN ('ok', 'pending')
    AND sat.source_song !~* '\b(2008|25th|anniversary|interview|voice.over|excerpt|karaoke|quincy|carousel|for all time|bonus|deluxe|rough|outtake|remix|reprise)\b'
),
ranked AS (
  SELECT
    album_id,
    acoustic_id,
    source_song,
    source_duration,
    row_number() OVER (PARTITION BY album_id ORDER BY acoustic_id) AS position
  FROM clean_acoustic
  WHERE rn = 1
),
missing AS (
  SELECT r.*
  FROM ranked r
  WHERE NOT EXISTS (
    SELECT 1 FROM canonical_album_tracks cat WHERE cat.album_id = r.album_id
  )
  AND r.album_id IN (
    SELECT album_id FROM ranked GROUP BY album_id HAVING count(*) >= 6
  )
)
INSERT INTO canonical_album_tracks (
  album_id,
  position,
  title,
  duration_seconds,
  acoustic_source_id,
  canonical_source,
  confidence_score,
  review_flag
)
SELECT
  m.album_id,
  m.position::int,
  trim(regexp_replace(m.source_song, '\s+-\s+.*$', '', 'i')),
  CASE WHEN m.source_duration > 0 THEN round(m.source_duration::numeric / 1000.0, 3) ELSE NULL END,
  m.acoustic_id,
  'clean_acoustic_fallback',
  0.55,
  'review_required'
FROM missing m
ON CONFLICT (album_id, position) DO NOTHING;

COMMIT;

SELECT count(*)::int AS canonical_rows FROM canonical_album_tracks;
SELECT count(DISTINCT album_id)::int AS albums_with_canonical FROM canonical_album_tracks;
