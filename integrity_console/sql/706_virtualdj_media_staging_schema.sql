-- 706_virtualdj_media_staging_schema.sql
-- Staging for VirtualDJ / local media linkage. No import in this phase.

BEGIN;

CREATE TABLE IF NOT EXISTS staging_virtualdj_tracks (
  id                 bigserial PRIMARY KEY,
  source_path        text NOT NULL,
  filename           text,
  artist_text        text,
  title_text         text,
  album_text         text,
  genre_text         text,
  year_text          text,
  play_count         integer,
  last_played        timestamp without time zone,
  duration_seconds   integer,
  vdj_guid           text,
  raw_payload        jsonb,
  content_hash       text NOT NULL,
  created_at         timestamp without time zone DEFAULT now(),
  UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_staging_vdj_artist_title
  ON staging_virtualdj_tracks (lower(artist_text), lower(title_text));

CREATE INDEX IF NOT EXISTS idx_staging_vdj_guid
  ON staging_virtualdj_tracks (vdj_guid)
  WHERE vdj_guid IS NOT NULL;

COMMIT;
