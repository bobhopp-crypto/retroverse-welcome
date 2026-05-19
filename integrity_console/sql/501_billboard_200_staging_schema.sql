-- 501_billboard_200_staging_schema.sql
-- Additive staging + linkage tables for Billboard 200 and MusicBrainz ingestion.
-- Safe to re-run (IF NOT EXISTS).

BEGIN;

-- Raw Billboard 200 weekly rows (load via COPY or ETL from SQLite export)
CREATE TABLE IF NOT EXISTS staging_billboard_200_weekly (
  id                 bigserial PRIMARY KEY,
  source_name        text NOT NULL DEFAULT 'billboard_200_sqlite',
  source_row_id      text,
  chart_date         date NOT NULL,
  chart_position     integer,
  source_artist      text NOT NULL,
  source_album       text NOT NULL,
  weeks_on_chart     integer,
  peak_position      integer,
  content_hash       text NOT NULL,
  import_batch_id    text,
  imported_at        timestamp without time zone DEFAULT now(),
  UNIQUE (source_name, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_staging_b200_weekly_date
  ON staging_billboard_200_weekly (chart_date);

CREATE INDEX IF NOT EXISTS idx_staging_b200_weekly_artist_album
  ON staging_billboard_200_weekly (lower(source_artist), lower(source_album));

-- Album tracklist rows (MusicBrainz / dossier / manual)
CREATE TABLE IF NOT EXISTS staging_album_tracklist_imports (
  id                 bigserial PRIMARY KEY,
  source_name        text NOT NULL,
  source_artist      text NOT NULL,
  source_album       text NOT NULL,
  edition_name       text,
  disc_number        integer DEFAULT 1,
  track_number       integer,
  track_title        text NOT NULL,
  mb_recording_mbid  text,
  mb_release_mbid    text,
  content_hash       text NOT NULL,
  import_batch_id    text,
  imported_at        timestamp without time zone DEFAULT now(),
  UNIQUE (source_name, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_staging_tracklist_release
  ON staging_album_tracklist_imports (mb_release_mbid);

CREATE INDEX IF NOT EXISTS idx_staging_tracklist_album
  ON staging_album_tracklist_imports (lower(source_artist), lower(source_album));

-- MusicBrainz release → canonical album mapping candidates
CREATE TABLE IF NOT EXISTS staging_musicbrainz_release_mappings (
  id                 bigserial PRIMARY KEY,
  source_name        text NOT NULL DEFAULT 'musicbrainz',
  mb_release_mbid    text NOT NULL,
  mb_artist_mbid     text,
  release_title      text NOT NULL,
  artist_name        text NOT NULL,
  release_year       integer,
  release_country    text,
  release_format     text,
  mapped_artist_id   bigint REFERENCES artists(id),
  mapped_album_id    bigint REFERENCES albums(id),
  mapping_confidence integer,
  mapping_status     text DEFAULT 'pending',
  content_hash       text NOT NULL,
  import_batch_id    text,
  imported_at        timestamp without time zone DEFAULT now(),
  UNIQUE (source_name, mb_release_mbid)
);

CREATE INDEX IF NOT EXISTS idx_staging_mb_release_album
  ON staging_musicbrainz_release_mappings (mapped_album_id);

-- Resolved Billboard 200 → canonical album chart linkage (review layer)
CREATE TABLE IF NOT EXISTS album_chart_linkage_candidates (
  id                 bigserial PRIMARY KEY,
  staging_row_id     bigint NOT NULL REFERENCES staging_billboard_200_weekly(id),
  resolved_artist_id bigint REFERENCES artists(id),
  resolved_album_id  bigint REFERENCES albums(id),
  match_method       text,
  confidence_score   integer,
  review_flag        text DEFAULT 'pending',
  chart_inserted     boolean DEFAULT false,
  created_at         timestamp without time zone DEFAULT now(),
  UNIQUE (staging_row_id)
);

CREATE INDEX IF NOT EXISTS idx_album_chart_linkage_album
  ON album_chart_linkage_candidates (resolved_album_id);

CREATE INDEX IF NOT EXISTS idx_album_chart_linkage_review
  ON album_chart_linkage_candidates (review_flag);

-- Album → edition → track_family lineage (populated by 504)
CREATE TABLE IF NOT EXISTS album_track_lineage (
  id                 bigserial PRIMARY KEY,
  album_id           bigint NOT NULL REFERENCES albums(id),
  album_edition_id   bigint REFERENCES album_editions(id),
  track_family_id    bigint REFERENCES track_families(id),
  track_id           bigint REFERENCES tracks(id),
  disc_number        integer DEFAULT 1,
  track_number       integer,
  sequence_index     integer,
  source_provenance  text NOT NULL,
  source_row_hash    text,
  created_at         timestamp without time zone DEFAULT now(),
  UNIQUE (source_provenance, source_row_hash)
);

CREATE INDEX IF NOT EXISTS idx_album_track_lineage_album
  ON album_track_lineage (album_id);

CREATE INDEX IF NOT EXISTS idx_album_track_lineage_family
  ON album_track_lineage (track_family_id);

COMMIT;
