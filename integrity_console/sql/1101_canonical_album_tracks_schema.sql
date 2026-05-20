-- 1101_canonical_album_tracks_schema.sql
-- Persistent canonical album listening sequences (original LP order + acoustic enrichment).
-- Additive. Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS canonical_album_tracks (
  id                    bigserial PRIMARY KEY,
  album_id              bigint NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  album_edition_id      bigint REFERENCES album_editions(id),
  track_id              bigint REFERENCES tracks(id),
  track_family_id       bigint REFERENCES track_families(id),
  position              integer NOT NULL CHECK (position > 0),
  title                 text NOT NULL,
  duration_seconds      numeric,
  acoustic_source_id    bigint REFERENCES staging_acoustic_tracks(id),
  musicbrainz_position  integer,
  canonical_source      text NOT NULL,
  confidence_score      numeric NOT NULL DEFAULT 0,
  review_flag           text NOT NULL DEFAULT 'ok',
  created_at            timestamp without time zone NOT NULL DEFAULT now(),
  updated_at            timestamp without time zone NOT NULL DEFAULT now(),
  UNIQUE (album_id, position)
);

CREATE INDEX IF NOT EXISTS idx_canonical_album_tracks_album
  ON canonical_album_tracks (album_id);

CREATE INDEX IF NOT EXISTS idx_canonical_album_tracks_track
  ON canonical_album_tracks (track_id);

CREATE INDEX IF NOT EXISTS idx_canonical_album_tracks_track_family
  ON canonical_album_tracks (track_family_id);

CREATE INDEX IF NOT EXISTS idx_canonical_album_tracks_review
  ON canonical_album_tracks (review_flag);

CREATE INDEX IF NOT EXISTS idx_canonical_album_tracks_source
  ON canonical_album_tracks (canonical_source);

CREATE INDEX IF NOT EXISTS idx_canonical_album_tracks_acoustic
  ON canonical_album_tracks (acoustic_source_id);

-- Staging buffer for CSV export/import (see scripts/export_canonical_album_tracks_staging.py)
CREATE TABLE IF NOT EXISTS staging_canonical_album_track_imports (
  external_key          text NOT NULL,
  position              integer NOT NULL,
  title                 text NOT NULL,
  canonical_source      text NOT NULL,
  confidence_score      numeric NOT NULL DEFAULT 0.9,
  musicbrainz_position  integer,
  acoustic_staging_id   text,
  review_flag           text NOT NULL DEFAULT 'ok'
);

CREATE OR REPLACE VIEW canonical_album_track_display AS
SELECT
  cat.id,
  cat.album_id,
  aek.external_key AS retroverse_album_key,
  al.title AS album_title,
  ar.canonical_name AS artist_name,
  cat.position,
  cat.title AS canonical_title,
  cat.duration_seconds,
  cat.acoustic_source_id,
  cat.musicbrainz_position,
  cat.canonical_source,
  cat.confidence_score,
  cat.review_flag,
  cat.track_id,
  cat.track_family_id,
  sat.source_song AS acoustic_title,
  sat.acousticness,
  sat.danceability,
  sat.energy,
  sat.valence,
  sat.liveness,
  sat.speechiness,
  sat.tempo,
  sat.loudness,
  sat.instrumentalness,
  CASE
    WHEN sat.energy IS NULL AND sat.valence IS NULL THEN NULL
    ELSE round(
      (
        coalesce(sat.energy, 0)
        + coalesce(sat.valence, 0)
        + coalesce(sat.danceability, 0)
        + coalesce(sat.liveness, 0)
      ) / NULLIF(
        (CASE WHEN sat.energy IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN sat.valence IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN sat.danceability IS NOT NULL THEN 1 ELSE 0 END)
        + (CASE WHEN sat.liveness IS NOT NULL THEN 1 ELSE 0 END),
        0
      ) * 100
    )::integer
  END AS signal_score
FROM canonical_album_tracks cat
JOIN albums al ON al.id = cat.album_id
JOIN artists ar ON ar.id = al.artist_id
LEFT JOIN album_external_keys aek ON aek.album_id = cat.album_id
LEFT JOIN staging_acoustic_tracks sat ON sat.id = cat.acoustic_source_id;

COMMIT;
