-- 912_vdj_instances_cues_staging_load.sql
-- Optional local load from parse_virtualdj_database.py CSV exports.
--
-- Prerequisite:
--   python3 scripts/parse_virtualdj_database.py
--   psql -f integrity_console/sql/910_retroverse_vdj_instances_cues_schema.sql
--
-- Copy tracks (repo root):
--   psql -U bobhopp -d retroverse -c "\copy staging_vdj_instances_import_buffer FROM 'exports/virtualdj/virtualdj_tracks.csv' CSV HEADER"
--   psql -U bobhopp -d retroverse -c "\copy staging_vdj_cues_import_buffer FROM 'exports/virtualdj/virtualdj_cues.csv' CSV HEADER"
--
-- Then:
--   psql -U bobhopp -d retroverse -f integrity_console/sql/912_vdj_instances_cues_staging_load.sql

BEGIN;

CREATE TABLE IF NOT EXISTS staging_vdj_instances_import_buffer (
  source_path text,
  filename text,
  artist_text text,
  title_text text,
  album_text text,
  genre_text text,
  year_text text,
  duration_seconds text,
  play_count text,
  last_played text,
  file_size text,
  filepath_hash text,
  vdj_guid text,
  thumbnail_path text,
  media_type text,
  vdj_song_flag text,
  vdj_tags_flag text,
  bpm_raw text,
  musical_key text,
  comments text,
  tags_json text,
  linked_cover_url text,
  linked_netsearch_id text,
  file_hash text,
  content_hash text
);

CREATE TABLE IF NOT EXISTS staging_vdj_cues_import_buffer (
  filepath_hash text,
  cue_number text,
  cue_name text,
  cue_type text,
  time_position_seconds text,
  color text,
  loop_data text,
  is_thumbnail text
);

-- Minimal load: instances without RVTR match (run npm run vdj:ingest for graph linkage).
INSERT INTO retroverse_track_instances (
  track_instance_id,
  file_path,
  filepath_hash,
  file_hash,
  media_type,
  play_count,
  last_played,
  vdj_song_flag,
  vdj_tags_flag,
  bpm_raw,
  musical_key,
  duration_seconds,
  comments,
  tags,
  linked_cover_url,
  linked_netsearch_id,
  thumbnail_path,
  vdj_guid,
  updated_at
)
SELECT
  'RVIN' || lpad((abs(hashtext('vdj_instance::' || b.filepath_hash)) % 1000000)::text, 6, '0'),
  b.source_path,
  b.filepath_hash,
  NULLIF(trim(b.file_hash), ''),
  coalesce(nullif(trim(b.media_type), ''), 'other'),
  NULLIF(trim(b.play_count), '')::int,
  NULLIF(trim(b.last_played), '')::timestamptz,
  NULLIF(trim(b.vdj_song_flag), '')::int,
  NULLIF(trim(b.vdj_tags_flag), '')::int,
  NULLIF(trim(b.bpm_raw), ''),
  NULLIF(trim(b.musical_key), ''),
  NULLIF(trim(b.duration_seconds), '')::int,
  NULLIF(trim(b.comments), ''),
  coalesce(b.tags_json::jsonb, '{}'::jsonb),
  NULLIF(trim(b.linked_cover_url), ''),
  NULLIF(trim(b.linked_netsearch_id), ''),
  NULLIF(trim(b.thumbnail_path), ''),
  NULLIF(trim(b.vdj_guid), ''),
  now()
FROM staging_vdj_instances_import_buffer b
WHERE coalesce(trim(b.filepath_hash), '') <> ''
ON CONFLICT (filepath_hash) DO UPDATE SET
  play_count = EXCLUDED.play_count,
  last_played = EXCLUDED.last_played,
  bpm_raw = EXCLUDED.bpm_raw,
  musical_key = EXCLUDED.musical_key,
  duration_seconds = EXCLUDED.duration_seconds,
  tags = EXCLUDED.tags,
  thumbnail_path = EXCLUDED.thumbnail_path,
  updated_at = now();

INSERT INTO retroverse_track_cues (
  cue_id,
  track_instance_id,
  cue_number,
  cue_name,
  cue_type,
  time_position_seconds,
  color,
  loop_data,
  is_thumbnail,
  updated_at
)
SELECT
  'RVCU' || lpad((abs(hashtext('vdj_cue::' || c.filepath_hash || '::' || c.cue_number)) % 1000000)::text, 6, '0'),
  i.track_instance_id,
  NULLIF(trim(c.cue_number), '')::int,
  NULLIF(trim(c.cue_name), ''),
  coalesce(nullif(trim(c.cue_type), ''), 'cue'),
  NULLIF(trim(c.time_position_seconds), '')::numeric,
  NULLIF(trim(c.color), '')::bigint,
  CASE WHEN coalesce(trim(c.loop_data), '') = '' THEN NULL ELSE c.loop_data::jsonb END,
  coalesce(trim(c.is_thumbnail), '') IN ('1', 'true', 't', 'yes'),
  now()
FROM staging_vdj_cues_import_buffer c
JOIN retroverse_track_instances i ON i.filepath_hash = c.filepath_hash
WHERE coalesce(trim(c.cue_number), '') <> ''
ON CONFLICT (track_instance_id, cue_number) DO UPDATE SET
  cue_name = EXCLUDED.cue_name,
  time_position_seconds = EXCLUDED.time_position_seconds,
  is_thumbnail = EXCLUDED.is_thumbnail,
  updated_at = now();

COMMIT;

SELECT count(*)::int AS instances FROM retroverse_track_instances;
SELECT count(*)::int AS thumbnail_cues FROM retroverse_track_cues WHERE is_thumbnail;
