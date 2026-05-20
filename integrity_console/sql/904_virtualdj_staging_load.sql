-- 904_virtualdj_staging_load.sql
-- Load staging_virtualdj_tracks from CSV export (idempotent).
--
-- Prerequisite:
--   python3 scripts/parse_virtualdj_database.py
--
-- Step 1 — copy into buffer (repo root):
--   psql -U bobhopp -d retroverse -c "\copy staging_virtualdj_tracks_import_buffer (
--     source_path, filename, artist_text, title_text, album_text, genre_text, year_text,
--     duration_seconds, play_count, last_played, file_size, filepath_hash, vdj_guid,
--     thumbnail_path, content_hash
--   ) FROM 'exports/virtualdj/virtualdj_tracks.csv' CSV HEADER"
--
-- Step 2:
--   psql -U bobhopp -d retroverse -f integrity_console/sql/904_virtualdj_staging_load.sql

BEGIN;

INSERT INTO staging_virtualdj_tracks (
  source_path,
  filename,
  artist_text,
  title_text,
  album_text,
  genre_text,
  year_text,
  duration_seconds,
  play_count,
  last_played,
  file_size,
  filepath_hash,
  vdj_guid,
  thumbnail_path,
  content_hash
)
SELECT
  b.source_path,
  b.filename,
  b.artist_text,
  b.title_text,
  b.album_text,
  b.genre_text,
  b.year_text,
  NULLIF(trim(b.duration_seconds), '')::int,
  NULLIF(trim(b.play_count), '')::int,
  NULLIF(trim(b.last_played), '')::timestamp,
  NULLIF(trim(b.file_size), '')::bigint,
  b.filepath_hash,
  NULLIF(trim(b.vdj_guid), ''),
  NULLIF(trim(b.thumbnail_path), ''),
  b.content_hash
FROM staging_virtualdj_tracks_import_buffer b
WHERE coalesce(trim(b.content_hash), '') <> ''
ON CONFLICT (content_hash) DO NOTHING;

COMMIT;

SELECT count(*)::int AS staging_virtualdj_rows FROM staging_virtualdj_tracks;
