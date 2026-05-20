-- 803_load_acoustics_staging.sql
-- Load staging_acoustic_tracks from CSV (idempotent via content_hash).
--
-- Step 1 — export:
--   python3 scripts/export_acoustics_from_sqlite.py
--
-- Step 2 — copy into buffer (repo root):
--   psql -U bobhopp -d retroverse -c "\copy staging_acoustic_tracks_import_buffer (
--     source_artist, source_album, source_song, source_duration, source_release_year,
--     acousticness, danceability, energy, instrumentalness, liveness, loudness,
--     speechiness, tempo, valence, source_row_id, content_hash
--   ) FROM 'exports/acoustics/acoustics_export.csv' CSV HEADER"
--
-- Step 3 — run this file:
--   psql -U bobhopp -d retroverse -f integrity_console/sql/803_load_acoustics_staging.sql

BEGIN;

INSERT INTO staging_acoustic_tracks (
  source_artist,
  source_album,
  source_song,
  source_duration,
  source_release_year,
  acousticness,
  danceability,
  energy,
  instrumentalness,
  liveness,
  loudness,
  speechiness,
  tempo,
  valence,
  source_row_id,
  content_hash
)
SELECT
  b.source_artist,
  b.source_album,
  b.source_song,
  NULLIF(trim(b.source_duration), '')::int,
  NULLIF(trim(b.source_release_year), '')::int,
  NULLIF(trim(b.acousticness), '')::double precision,
  NULLIF(trim(b.danceability), '')::double precision,
  NULLIF(trim(b.energy), '')::double precision,
  NULLIF(trim(b.instrumentalness), '')::double precision,
  NULLIF(trim(b.liveness), '')::double precision,
  NULLIF(trim(b.loudness), '')::double precision,
  NULLIF(trim(b.speechiness), '')::double precision,
  NULLIF(trim(b.tempo), '')::double precision,
  NULLIF(trim(b.valence), '')::double precision,
  b.source_row_id,
  b.content_hash
FROM staging_acoustic_tracks_import_buffer b
WHERE coalesce(trim(b.content_hash), '') <> ''
ON CONFLICT (content_hash) DO NOTHING;

COMMIT;

SELECT count(*)::int AS staging_rows FROM staging_acoustic_tracks;
