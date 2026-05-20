-- 901_media_asset_schema.sql
-- Phase 9: Media asset graph schema (extends Phase 7 linkage tables).
-- Additive DDL only. Safe to re-run.

BEGIN;

-- Extend media_assets (created in 701)
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS directory_path text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS file_extension text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS genre_text text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS year_text text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS play_count integer;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS last_played timestamp without time zone;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS content_hash text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS local_thumbnail_path text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS r2_media_key text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS r2_thumbnail_key text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS youtube_url text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS youtube_video_id text;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS updated_at timestamp without time zone DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_content_hash
  ON media_assets (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_vdj_guid
  ON media_assets (vdj_guid)
  WHERE vdj_guid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_media_assets_artist_title
  ON media_assets (lower(artist_text), lower(title_text));

CREATE INDEX IF NOT EXISTS idx_media_assets_content_hash
  ON media_assets (content_hash)
  WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS media_asset_link_candidates (
  id                      bigserial PRIMARY KEY,
  staging_virtualdj_id    bigint REFERENCES staging_virtualdj_tracks(id),
  candidate_track_id      bigint REFERENCES tracks(id),
  candidate_track_family_id bigint REFERENCES track_families(id),
  candidate_album_id      bigint REFERENCES albums(id),
  confidence_score        integer,
  match_reason              text,
  review_flag               text NOT NULL DEFAULT 'pending',
  created_at                timestamp without time zone DEFAULT now(),
  UNIQUE (staging_virtualdj_id, candidate_track_id, candidate_album_id)
);

CREATE INDEX IF NOT EXISTS idx_media_asset_link_candidates_review
  ON media_asset_link_candidates (review_flag);

CREATE INDEX IF NOT EXISTS idx_media_asset_link_candidates_staging
  ON media_asset_link_candidates (staging_virtualdj_id);

COMMIT;
