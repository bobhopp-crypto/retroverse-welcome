-- 301_track_family_schema.sql
-- Additive schema for canonical track family modeling.
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT DO NOTHING).

BEGIN;

CREATE TABLE IF NOT EXISTS track_variant_types (
  id            bigserial PRIMARY KEY,
  variant_key   text NOT NULL UNIQUE,
  variant_name  text NOT NULL,
  description   text
);

CREATE TABLE IF NOT EXISTS track_families (
  id                  bigserial PRIMARY KEY,
  canonical_name      text NOT NULL,
  canonical_artist_id bigint NOT NULL REFERENCES artists(id),
  normalized_family_key text NOT NULL UNIQUE,
  created_at          timestamp without time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_track_families_artist
  ON track_families (canonical_artist_id);

CREATE INDEX IF NOT EXISTS idx_track_families_canonical_name
  ON track_families (canonical_name);

CREATE TABLE IF NOT EXISTS track_family_members (
  id                   bigserial PRIMARY KEY,
  track_family_id      bigint NOT NULL REFERENCES track_families(id),
  track_id             bigint NOT NULL UNIQUE REFERENCES tracks(id),
  relationship_type    text NOT NULL DEFAULT 'variant',
  confidence_score     integer,
  is_primary_recording boolean NOT NULL DEFAULT false,
  created_at           timestamp without time zone DEFAULT now(),
  UNIQUE (track_family_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_track_family_members_family
  ON track_family_members (track_family_id);

CREATE INDEX IF NOT EXISTS idx_track_family_members_primary
  ON track_family_members (track_family_id)
  WHERE is_primary_recording = true;

INSERT INTO track_variant_types (variant_key, variant_name, description)
VALUES
  ('studio', 'Studio', 'Standard studio recording'),
  ('remaster', 'Remaster', 'Remastered release of a recording'),
  ('live', 'Live', 'Live performance recording'),
  ('remix', 'Remix', 'Remixed version'),
  ('mono', 'Mono', 'Mono mix'),
  ('stereo', 'Stereo', 'Stereo mix'),
  ('radio_edit', 'Radio Edit', 'Radio edit or single cut'),
  ('acoustic', 'Acoustic', 'Acoustic version'),
  ('instrumental', 'Instrumental', 'Instrumental version'),
  ('karaoke', 'Karaoke', 'Karaoke or backing track'),
  ('clean', 'Clean', 'Clean / censored version'),
  ('explicit', 'Explicit', 'Explicit version'),
  ('alternate_mix', 'Alternate Mix', 'Alternate mix not otherwise classified'),
  ('unknown', 'Unknown', 'Unclassified variant')
ON CONFLICT (variant_key) DO NOTHING;

COMMIT;
