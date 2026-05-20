-- 902_virtualdj_xml_ingest_schema.sql
-- Extend VirtualDJ staging for XML ingest (Phase 9).

BEGIN;

ALTER TABLE staging_virtualdj_tracks ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE staging_virtualdj_tracks ADD COLUMN IF NOT EXISTS filepath_hash text;
ALTER TABLE staging_virtualdj_tracks ADD COLUMN IF NOT EXISTS thumbnail_path text;
ALTER TABLE staging_virtualdj_tracks ADD COLUMN IF NOT EXISTS raw_xml text;

CREATE INDEX IF NOT EXISTS idx_staging_vdj_filepath_hash
  ON staging_virtualdj_tracks (filepath_hash)
  WHERE filepath_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS staging_virtualdj_tracks_import_buffer (
  source_path        text,
  filename           text,
  artist_text        text,
  title_text         text,
  album_text         text,
  genre_text         text,
  year_text          text,
  duration_seconds   text,
  play_count         text,
  last_played        text,
  file_size          text,
  filepath_hash      text,
  vdj_guid           text,
  thumbnail_path     text,
  content_hash       text
);

COMMIT;
