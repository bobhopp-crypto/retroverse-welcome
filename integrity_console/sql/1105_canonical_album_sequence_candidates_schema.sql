-- 1105_canonical_album_sequence_candidates_schema.sql
-- Recovery-layer album sequence candidates (audit + export priority).
-- Additive. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_album_sequence_candidates (
  id                    bigserial PRIMARY KEY,
  album_id              bigint NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  position              integer NOT NULL CHECK (position > 0),
  canonical_title       text NOT NULL,
  sequence_source       text NOT NULL,
  confidence_score      numeric NOT NULL DEFAULT 0.5,
  review_flag           text NOT NULL DEFAULT 'ok',
  acoustic_staging_id   bigint REFERENCES staging_acoustic_tracks(id),
  variant_cluster_key   text,
  musicbrainz_position  integer,
  created_at            timestamp without time zone NOT NULL DEFAULT now(),
  updated_at            timestamp without time zone NOT NULL DEFAULT now(),
  UNIQUE (album_id, position, sequence_source)
);

CREATE INDEX IF NOT EXISTS idx_canonical_album_sequence_candidates_album
  ON canonical_album_sequence_candidates (album_id);

CREATE INDEX IF NOT EXISTS idx_canonical_album_sequence_candidates_source
  ON canonical_album_sequence_candidates (sequence_source);

CREATE INDEX IF NOT EXISTS idx_canonical_album_sequence_candidates_confidence
  ON canonical_album_sequence_candidates (confidence_score DESC);

COMMIT;
