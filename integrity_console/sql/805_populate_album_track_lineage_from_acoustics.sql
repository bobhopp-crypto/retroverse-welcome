-- 805_populate_album_track_lineage_from_acoustics.sql
-- Populate album_track_lineage + canonical_track_album_links from acoustic candidates.
-- Additive, idempotent. source = 'acoustics'.

BEGIN;

CREATE TEMP TABLE tmp_acoustic_materialize ON COMMIT DROP AS
SELECT
  c.*,
  sat.content_hash,
  row_number() OVER (
    PARTITION BY c.album_id, coalesce(c.album_edition_id, 0)
    ORDER BY c.staging_acoustic_id
  ) AS sequence_index
FROM acoustic_track_album_candidates c
JOIN staging_acoustic_tracks sat ON sat.id = c.staging_acoustic_id
WHERE c.album_id IS NOT NULL
  AND c.review_flag IN ('ok', 'review_required');

INSERT INTO album_track_lineage (
  album_id,
  album_edition_id,
  track_family_id,
  track_id,
  disc_number,
  track_number,
  sequence_index,
  source_provenance,
  source_row_hash
)
SELECT
  mc.album_id,
  mc.album_edition_id,
  mc.track_family_id,
  mc.track_id,
  1,
  mc.sequence_index,
  mc.sequence_index,
  'acoustics',
  'acoustic:' || mc.content_hash
FROM tmp_acoustic_materialize mc
ON CONFLICT (source_provenance, source_row_hash) DO NOTHING;

UPDATE tracks t
SET album_id = mc.album_id
FROM tmp_acoustic_materialize mc
WHERE mc.track_id = t.id
  AND mc.review_flag = 'ok'
  AND t.album_id IS NULL;

INSERT INTO canonical_track_album_links (
  track_family_id,
  album_id,
  album_edition_id,
  relationship_type,
  track_number,
  disc_number,
  confidence_score,
  source,
  review_flag
)
SELECT
  mc.track_family_id,
  mc.album_id,
  mc.album_edition_id,
  'appears_on',
  mc.sequence_index,
  1,
  mc.confidence_score,
  'acoustics',
  'ok'
FROM tmp_acoustic_materialize mc
WHERE mc.track_family_id IS NOT NULL
  AND mc.review_flag = 'ok'
  AND NOT EXISTS (
    SELECT 1 FROM canonical_track_album_links ctal
    WHERE ctal.track_family_id = mc.track_family_id
      AND ctal.album_id = mc.album_id
      AND coalesce(ctal.album_edition_id, 0) = coalesce(mc.album_edition_id, 0)
      AND ctal.source = 'acoustics'
  )
ON CONFLICT DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM album_track_lineage WHERE source_provenance = 'acoustics') AS acoustics_lineage,
  (SELECT count(*) FROM canonical_track_album_links WHERE source = 'acoustics') AS acoustics_ctal;
