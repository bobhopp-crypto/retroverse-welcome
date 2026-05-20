-- 701_linkage_schema.sql
-- Canonical linkage layer: track↔album, chart↔album, media↔track.
-- Additive DDL only. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_track_album_links (
  id                 bigserial PRIMARY KEY,
  track_family_id    bigint NOT NULL REFERENCES track_families(id),
  album_id           bigint NOT NULL REFERENCES albums(id),
  album_edition_id   bigint REFERENCES album_editions(id),
  relationship_type  text NOT NULL DEFAULT 'appears_on',
  track_number       integer,
  disc_number        integer DEFAULT 1,
  confidence_score   integer,
  source             text NOT NULL,
  review_flag        text NOT NULL DEFAULT 'pending',
  created_at         timestamp without time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_track_album_links_key
  ON canonical_track_album_links (
    track_family_id,
    album_id,
    coalesce(album_edition_id, 0),
    source
  );

CREATE INDEX IF NOT EXISTS idx_ctal_track_family
  ON canonical_track_album_links (track_family_id);

CREATE INDEX IF NOT EXISTS idx_ctal_album
  ON canonical_track_album_links (album_id);

CREATE INDEX IF NOT EXISTS idx_ctal_review
  ON canonical_track_album_links (review_flag);

CREATE TABLE IF NOT EXISTS chart_track_album_links (
  id                 bigserial PRIMARY KEY,
  chart_appearance_id bigint NOT NULL REFERENCES chart_appearances(id),
  track_id           bigint REFERENCES tracks(id),
  track_family_id    bigint REFERENCES track_families(id),
  album_id           bigint REFERENCES albums(id),
  album_edition_id   bigint REFERENCES album_editions(id),
  confidence_score   integer,
  source             text NOT NULL,
  review_flag        text NOT NULL DEFAULT 'pending',
  created_at         timestamp without time zone DEFAULT now(),
  UNIQUE (chart_appearance_id)
);

CREATE INDEX IF NOT EXISTS idx_ctchart_chart
  ON chart_track_album_links (chart_appearance_id);

CREATE INDEX IF NOT EXISTS idx_ctchart_album
  ON chart_track_album_links (album_id);

CREATE INDEX IF NOT EXISTS idx_ctchart_review
  ON chart_track_album_links (review_flag);

CREATE TABLE IF NOT EXISTS media_assets (
  id                 bigserial PRIMARY KEY,
  source_system      text NOT NULL,
  source_path        text,
  filename           text,
  artist_text        text,
  title_text         text,
  album_text         text,
  duration_seconds   integer,
  file_hash          text,
  vdj_guid           text,
  created_at         timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_source_system
  ON media_assets (source_system);

CREATE INDEX IF NOT EXISTS idx_media_assets_vdj_guid
  ON media_assets (vdj_guid)
  WHERE vdj_guid IS NOT NULL;

CREATE TABLE IF NOT EXISTS media_track_links (
  id                 bigserial PRIMARY KEY,
  media_asset_id     bigint NOT NULL REFERENCES media_assets(id),
  track_id           bigint REFERENCES tracks(id),
  track_family_id    bigint REFERENCES track_families(id),
  confidence_score   integer,
  match_reason       text,
  review_flag        text NOT NULL DEFAULT 'pending',
  created_at         timestamp without time zone DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_track_links_asset_track
  ON media_track_links (media_asset_id, coalesce(track_id, 0));

CREATE INDEX IF NOT EXISTS idx_media_track_links_asset
  ON media_track_links (media_asset_id);

CREATE INDEX IF NOT EXISTS idx_media_track_links_review
  ON media_track_links (review_flag);

COMMIT;
