-- 002_artist_merge_dry_run.sql
-- Preview a single artist merge. Does NOT modify data.
--
-- Set these in psql before running:
--   \set duplicate_artist_id 123
--   \set canonical_artist_id 456

WITH params AS (
  SELECT
    :duplicate_artist_id::bigint AS duplicate_artist_id,
    :canonical_artist_id::bigint AS canonical_artist_id
),
artists_check AS (
  SELECT
    p.duplicate_artist_id,
    p.canonical_artist_id,
    dup.canonical_name AS duplicate_artist_name,
    can.canonical_name AS canonical_artist_name
  FROM params p
  LEFT JOIN artists dup ON dup.id = p.duplicate_artist_id
  LEFT JOIN artists can ON can.id = p.canonical_artist_id
),
counts AS (
  SELECT
    ac.*,
    (SELECT count(*) FROM tracks t WHERE t.artist_id = ac.duplicate_artist_id) AS tracks_to_update,
    (SELECT count(*) FROM albums al WHERE al.artist_id = ac.duplicate_artist_id) AS albums_to_update,
    (SELECT count(*) FROM artist_aliases aa WHERE aa.artist_id = ac.duplicate_artist_id) AS aliases_to_update,
    (
      SELECT count(*)
      FROM artist_aliases dup_aa
      WHERE dup_aa.artist_id = ac.duplicate_artist_id
        AND EXISTS (
          SELECT 1
          FROM artist_aliases can_aa
          WHERE can_aa.artist_id = ac.canonical_artist_id
            AND lower(trim(can_aa.alias_name)) = lower(trim(dup_aa.alias_name))
        )
    ) AS duplicate_aliases_already_on_canonical,
    (
      SELECT count(*)
      FROM chart_appearances ca
      JOIN tracks tr ON tr.id = ca.track_id
      WHERE tr.artist_id = ac.duplicate_artist_id
    ) AS chart_appearances_via_tracks
  FROM artists_check ac
)
SELECT
  duplicate_artist_id,
  canonical_artist_id,
  duplicate_artist_name,
  canonical_artist_name,
  tracks_to_update,
  albums_to_update,
  aliases_to_update,
  duplicate_aliases_already_on_canonical,
  chart_appearances_via_tracks,
  CASE
    WHEN duplicate_artist_id IS NULL OR canonical_artist_id IS NULL THEN
      'ERROR: one or both artist IDs do not exist'
    WHEN duplicate_artist_id = canonical_artist_id THEN
      'ERROR: cannot merge artist into itself'
    WHEN duplicate_artist_name IS NULL OR canonical_artist_name IS NULL THEN
      'ERROR: missing artist row'
    WHEN lower(trim(duplicate_artist_name)) <> lower(trim(canonical_artist_name)) THEN
      'WARNING: names differ beyond case/spacing — manual review required'
    WHEN duplicate_artist_name = canonical_artist_name THEN
      'WARNING: identical canonical_name on both rows (unexpected duplicate group)'
    ELSE
      'OK: case/spacing variant merge looks safe'
  END AS safety_status
FROM counts;

-- Detail: alias rows that would be dropped due to canonical conflict
SELECT
  dup_aa.id AS duplicate_alias_id,
  dup_aa.alias_name AS duplicate_alias_name,
  'would delete or skip — canonical already has this alias' AS note
FROM artist_aliases dup_aa
WHERE dup_aa.artist_id = :duplicate_artist_id::bigint
  AND EXISTS (
    SELECT 1
    FROM artist_aliases can_aa
    WHERE can_aa.artist_id = :canonical_artist_id::bigint
      AND lower(trim(can_aa.alias_name)) = lower(trim(dup_aa.alias_name))
  )
ORDER BY dup_aa.alias_name;
