-- 1001_album_artwork_links_schema.sql
-- Formal album cover linkage (Phase 10). Additive DDL.

BEGIN;

CREATE TABLE IF NOT EXISTS album_external_keys (
  album_id       bigint PRIMARY KEY REFERENCES albums(id),
  external_key   text NOT NULL,
  source         text NOT NULL DEFAULT 'dossier_match',
  confidence_score integer,
  created_at     timestamp without time zone DEFAULT now(),
  UNIQUE (external_key)
);

CREATE INDEX IF NOT EXISTS idx_album_external_keys_key
  ON album_external_keys (external_key);

CREATE TABLE IF NOT EXISTS album_artwork_links (
  id                   bigserial PRIMARY KEY,
  album_id             bigint NOT NULL REFERENCES albums(id),
  album_edition_id     bigint REFERENCES album_editions(id),
  canonical_cover_path text,
  local_cover_path     text,
  r2_cover_key         text,
  source               text NOT NULL,
  confidence_score     integer,
  review_flag          text NOT NULL DEFAULT 'pending',
  created_at           timestamp without time zone DEFAULT now(),
  updated_at           timestamp without time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_album_artwork_links_album_source
  ON album_artwork_links (album_id, coalesce(album_edition_id, 0), source);

CREATE INDEX IF NOT EXISTS idx_album_artwork_links_review
  ON album_artwork_links (review_flag);

CREATE INDEX IF NOT EXISTS idx_album_artwork_links_album
  ON album_artwork_links (album_id);

CREATE TABLE IF NOT EXISTS staging_album_external_key_buffer (
  album_id       text,
  external_key   text,
  source         text,
  confidence_score text
);

CREATE TABLE IF NOT EXISTS staging_album_artwork_link_buffer (
  album_id             text,
  album_edition_id     text,
  canonical_cover_path text,
  local_cover_path     text,
  r2_cover_key         text,
  source               text,
  confidence_score     text,
  review_flag          text
);

COMMIT;
