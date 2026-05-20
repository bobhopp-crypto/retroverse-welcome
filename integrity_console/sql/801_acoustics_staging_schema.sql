-- 801_acoustics_staging_schema.sql
-- Phase 8A: acoustic bridge staging + candidate review tables.
-- Additive DDL only. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS staging_acoustic_tracks (
  id                   bigserial PRIMARY KEY,
  source_artist        text NOT NULL,
  source_album         text NOT NULL,
  source_song          text NOT NULL,
  source_duration      integer,
  source_release_year  integer,
  acousticness         double precision,
  danceability         double precision,
  energy               double precision,
  instrumentalness     double precision,
  liveness             double precision,
  loudness             double precision,
  speechiness          double precision,
  tempo                double precision,
  valence              double precision,
  source_row_id        text,
  content_hash         text NOT NULL,
  created_at           timestamp without time zone DEFAULT now(),
  UNIQUE (content_hash)
);

CREATE INDEX IF NOT EXISTS idx_staging_acoustic_tracks_artist_song
  ON staging_acoustic_tracks (lower(trim(source_artist)), lower(trim(source_song)));

CREATE INDEX IF NOT EXISTS idx_staging_acoustic_tracks_artist_album
  ON staging_acoustic_tracks (lower(trim(source_artist)), lower(trim(source_album)));

CREATE TABLE IF NOT EXISTS acoustic_track_album_candidates (
  id                   bigserial PRIMARY KEY,
  staging_acoustic_id  bigint NOT NULL REFERENCES staging_acoustic_tracks(id),
  canonical_artist_id  bigint REFERENCES artists(id),
  track_id             bigint REFERENCES tracks(id),
  track_family_id      bigint REFERENCES track_families(id),
  album_id             bigint REFERENCES albums(id),
  album_edition_id     bigint REFERENCES album_editions(id),
  confidence_score     integer,
  match_reason         text,
  review_flag          text NOT NULL DEFAULT 'pending',
  created_at           timestamp without time zone DEFAULT now(),
  UNIQUE (staging_acoustic_id, album_id)
);

CREATE INDEX IF NOT EXISTS idx_acoustic_candidates_staging
  ON acoustic_track_album_candidates (staging_acoustic_id);

CREATE INDEX IF NOT EXISTS idx_acoustic_candidates_review
  ON acoustic_track_album_candidates (review_flag);

CREATE INDEX IF NOT EXISTS idx_acoustic_candidates_album
  ON acoustic_track_album_candidates (album_id);

CREATE TABLE IF NOT EXISTS staging_acoustic_tracks_import_buffer (
  source_artist        text,
  source_album         text,
  source_song          text,
  source_duration      text,
  source_release_year  text,
  acousticness         text,
  danceability         text,
  energy               text,
  instrumentalness     text,
  liveness             text,
  loudness             text,
  speechiness          text,
  tempo                text,
  valence              text,
  source_row_id        text,
  content_hash         text
);

COMMIT;
