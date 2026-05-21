-- 1201_canonical_track_graph_schema.sql
-- Canonical track identity (RVTR) separate from recordings/versions/media.
-- Additive. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_tracks (
  id                      bigserial PRIMARY KEY,
  track_id                  text NOT NULL,
  canonical_title           text NOT NULL,
  normalized_title_key      text NOT NULL,
  artist_id                 bigint REFERENCES artists(id),
  canonical_artist_name     text,
  first_chart_date          date,
  peak_hot100_position      integer,
  chart_weeks               integer NOT NULL DEFAULT 0,
  has_hot100                boolean NOT NULL DEFAULT false,
  has_vdj_media             boolean NOT NULL DEFAULT false,
  has_video                 boolean NOT NULL DEFAULT false,
  has_audio                 boolean NOT NULL DEFAULT false,
  has_youtube               boolean NOT NULL DEFAULT false,
  graph_track_id            bigint REFERENCES tracks(id),
  track_family_id           bigint REFERENCES track_families(id),
  retroverse_track_id       text,
  identity_source           text NOT NULL,
  confidence_score          numeric NOT NULL DEFAULT 0.9,
  review_flag               text NOT NULL DEFAULT 'ok',
  created_at                timestamp without time zone NOT NULL DEFAULT now(),
  updated_at                timestamp without time zone NOT NULL DEFAULT now(),
  CONSTRAINT canonical_tracks_track_id_rvtr CHECK (track_id ~ '^RVTR[0-9]{6}$'),
  CONSTRAINT canonical_tracks_retroverse_track_id_rvtr CHECK (
    retroverse_track_id IS NULL OR retroverse_track_id ~ '^RVTR[0-9]{6}$'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_tracks_track_id
  ON canonical_tracks (track_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_tracks_artist_title
  ON canonical_tracks (artist_id, normalized_title_key)
  WHERE artist_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_canonical_tracks_artist_name
  ON canonical_tracks (lower(canonical_artist_name));

CREATE INDEX IF NOT EXISTS idx_canonical_tracks_norm_title
  ON canonical_tracks (normalized_title_key);

CREATE INDEX IF NOT EXISTS idx_canonical_tracks_hot100
  ON canonical_tracks (has_hot100, peak_hot100_position);

CREATE INDEX IF NOT EXISTS idx_canonical_tracks_vdj
  ON canonical_tracks (has_vdj_media);

CREATE INDEX IF NOT EXISTS idx_canonical_tracks_review
  ON canonical_tracks (review_flag);

CREATE TABLE IF NOT EXISTS canonical_track_versions (
  id                      bigserial PRIMARY KEY,
  canonical_track_id      bigint NOT NULL REFERENCES canonical_tracks(id) ON DELETE CASCADE,
  source_type             text NOT NULL,
  source_track_key        text,
  source_title            text NOT NULL,
  source_artist           text,
  source_album            text,
  version_type            text NOT NULL DEFAULT 'variant',
  release_date            date,
  is_primary              boolean NOT NULL DEFAULT false,
  confidence_score        numeric NOT NULL DEFAULT 0.5,
  graph_track_id          bigint REFERENCES tracks(id),
  acoustic_source_id      bigint REFERENCES staging_acoustic_tracks(id),
  media_asset_id          bigint REFERENCES media_assets(id),
  created_at              timestamp without time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canonical_track_versions_canonical
  ON canonical_track_versions (canonical_track_id);

CREATE INDEX IF NOT EXISTS idx_canonical_track_versions_source
  ON canonical_track_versions (source_type, source_track_key);

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_track_versions_graph
  ON canonical_track_versions (canonical_track_id, graph_track_id)
  WHERE graph_track_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_track_versions_acoustic
  ON canonical_track_versions (canonical_track_id, acoustic_source_id)
  WHERE acoustic_source_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_track_versions_media
  ON canonical_track_versions (canonical_track_id, media_asset_id)
  WHERE media_asset_id IS NOT NULL;

-- Staging buffers (export_canonical_track_graph_staging.py)
CREATE TABLE IF NOT EXISTS staging_canonical_track_imports (
  track_id                  text NOT NULL,
  canonical_title           text NOT NULL,
  normalized_title_key      text NOT NULL,
  artist_id                 text,
  canonical_artist_name     text NOT NULL,
  first_chart_date          text,
  peak_hot100_position      text,
  chart_weeks               integer NOT NULL DEFAULT 0,
  has_hot100                text NOT NULL DEFAULT 'false',
  has_vdj_media             text NOT NULL DEFAULT 'false',
  has_video                 text NOT NULL DEFAULT 'false',
  has_audio                 text NOT NULL DEFAULT 'false',
  has_youtube               text NOT NULL DEFAULT 'false',
  graph_track_id            text,
  track_family_id           text,
  retroverse_track_id       text,
  identity_source           text NOT NULL,
  confidence_score          numeric NOT NULL DEFAULT 0.9,
  review_flag               text NOT NULL DEFAULT 'ok'
);

CREATE TABLE IF NOT EXISTS staging_canonical_track_version_imports (
  track_id                  text NOT NULL,
  source_type               text NOT NULL,
  source_track_key          text,
  source_title              text NOT NULL,
  source_artist             text,
  source_album              text,
  version_type              text NOT NULL DEFAULT 'variant',
  release_date              text,
  is_primary                text NOT NULL DEFAULT 'false',
  confidence_score          numeric NOT NULL DEFAULT 0.5,
  graph_track_id            text,
  acoustic_source_id        text,
  media_asset_id            text
);

-- Link album canonical rows → RVTR (enrichment only; sequence unchanged)
ALTER TABLE canonical_album_tracks
  ADD COLUMN IF NOT EXISTS canonical_track_key text;

CREATE INDEX IF NOT EXISTS idx_canonical_album_tracks_rvtr
  ON canonical_album_tracks (canonical_track_key)
  WHERE canonical_track_key IS NOT NULL;

CREATE OR REPLACE VIEW canonical_track_display AS
SELECT
  ct.id,
  ct.track_id,
  ct.canonical_title,
  ct.normalized_title_key,
  ct.artist_id,
  ct.canonical_artist_name,
  ct.first_chart_date,
  ct.peak_hot100_position,
  ct.chart_weeks,
  ct.has_hot100,
  ct.has_vdj_media,
  ct.has_video,
  ct.has_audio,
  ct.has_youtube,
  ct.graph_track_id,
  ct.track_family_id,
  ct.retroverse_track_id,
  ct.identity_source,
  ct.confidence_score,
  ct.review_flag,
  (SELECT count(*)::int FROM canonical_track_versions v WHERE v.canonical_track_id = ct.id) AS version_count
FROM canonical_tracks ct;

COMMIT;
