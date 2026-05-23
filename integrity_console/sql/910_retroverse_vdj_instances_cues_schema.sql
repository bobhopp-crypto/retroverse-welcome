-- 910_retroverse_vdj_instances_cues_schema.sql
-- Local PostgreSQL mirror of Supabase VDJ operational tables (read/reporting).

BEGIN;

CREATE TABLE IF NOT EXISTS retroverse_track_instances (
  track_instance_id   text PRIMARY KEY CHECK (track_instance_id ~ '^RVIN[0-9]{6}$'),
  retroverse_track_id text,
  file_path           text NOT NULL,
  filepath_hash       text NOT NULL UNIQUE,
  file_hash           text,
  media_type          text NOT NULL DEFAULT 'other',
  play_count          integer,
  last_played         timestamptz,
  vdj_song_flag       integer,
  vdj_tags_flag       integer,
  bpm_raw             text,
  musical_key         text,
  duration_seconds    integer,
  comments            text,
  tags                jsonb NOT NULL DEFAULT '{}'::jsonb,
  linked_cover_url    text,
  linked_netsearch_id text,
  thumbnail_path      text,
  vdj_guid            text,
  match_confidence    numeric(6,4),
  match_method        text,
  imported_at         timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rv_track_instances_rvtr
  ON retroverse_track_instances (retroverse_track_id);

CREATE TABLE IF NOT EXISTS retroverse_track_cues (
  cue_id                text PRIMARY KEY CHECK (cue_id ~ '^RVCU[0-9]{6}$'),
  track_instance_id     text NOT NULL REFERENCES retroverse_track_instances(track_instance_id) ON DELETE CASCADE,
  cue_number            integer NOT NULL CHECK (cue_number >= 0 AND cue_number <= 64),
  cue_name              text,
  cue_type              text NOT NULL DEFAULT 'cue',
  time_position_seconds numeric(12,6),
  color                 bigint,
  loop_data             jsonb,
  is_thumbnail          boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (track_instance_id, cue_number)
);

CREATE INDEX IF NOT EXISTS idx_rv_track_cues_thumbnail
  ON retroverse_track_cues (track_instance_id)
  WHERE is_thumbnail = true;

CREATE TABLE IF NOT EXISTS retroverse_vdj_ingest_runs (
  ingest_run_id       bigserial PRIMARY KEY,
  source_xml_path     text NOT NULL,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  status              text NOT NULL DEFAULT 'running',
  instances_upserted  integer NOT NULL DEFAULT 0,
  cues_upserted       integer NOT NULL DEFAULT 0,
  instances_matched   integer NOT NULL DEFAULT 0,
  thumbnail_cues      integer NOT NULL DEFAULT 0,
  error_message       text,
  notes               text
);

COMMIT;
