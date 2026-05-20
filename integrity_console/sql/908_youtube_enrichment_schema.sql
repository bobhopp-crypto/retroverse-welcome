-- 908_youtube_enrichment_schema.sql
-- YouTube enrichment linkage (not canonical identity).

BEGIN;

CREATE TABLE IF NOT EXISTS youtube_track_links (
  id                 bigserial PRIMARY KEY,
  track_id           bigint REFERENCES tracks(id),
  track_family_id    bigint REFERENCES track_families(id),
  album_id           bigint REFERENCES albums(id),
  youtube_url        text,
  youtube_video_id   text,
  source             text NOT NULL,
  confidence_score   integer,
  review_flag        text NOT NULL DEFAULT 'pending',
  created_at         timestamp without time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_youtube_track_links_video
  ON youtube_track_links (youtube_video_id)
  WHERE youtube_video_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_youtube_track_links_track
  ON youtube_track_links (track_id);

CREATE INDEX IF NOT EXISTS idx_youtube_track_links_review
  ON youtube_track_links (review_flag);

CREATE TABLE IF NOT EXISTS staging_youtube_link_imports (
  id                 bigserial PRIMARY KEY,
  source_name        text NOT NULL,
  artist_text        text,
  title_text         text,
  youtube_url        text,
  youtube_video_id   text,
  content_hash       text NOT NULL,
  created_at         timestamp without time zone DEFAULT now(),
  UNIQUE (content_hash)
);

CREATE TABLE IF NOT EXISTS staging_youtube_link_import_buffer (
  source_name        text,
  artist_text        text,
  title_text         text,
  youtube_url        text,
  youtube_video_id   text,
  content_hash       text
);

COMMIT;
