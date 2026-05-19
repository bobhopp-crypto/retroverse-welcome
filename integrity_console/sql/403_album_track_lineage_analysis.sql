-- 403_album_track_lineage_analysis.sql
-- Album ↔ track family lineage. Read-only.

WITH track_family_map AS (
  SELECT
    tfm.track_id,
    tf.id AS track_family_id,
    tf.canonical_name AS track_family_name,
    tfm.relationship_type,
    tfm.is_primary_recording
  FROM track_family_members tfm
  JOIN track_families tf ON tf.id = tfm.track_family_id
),
album_track_base AS (
  SELECT
    a.canonical_name AS artist,
    al.id AS album_id,
    al.title AS album,
    coalesce(ae.edition_name, '(no edition row)') AS edition,
    ae.is_canonical AS edition_is_canonical,
    t.id AS track_id,
    t.title AS track_title,
    tfm.track_family_id,
    tfm.track_family_name,
    coalesce(tfm.relationship_type, 'unlinked_family') AS track_variant,
    tfm.is_primary_recording
  FROM albums al
  JOIN artists a ON a.id = al.artist_id
  LEFT JOIN album_editions ae ON ae.album_id = al.id
  LEFT JOIN tracks t ON t.album_id = al.id
  LEFT JOIN track_family_map tfm ON tfm.track_id = t.id
),
album_family_stats AS (
  SELECT
    album_id,
    count(DISTINCT track_family_id) FILTER (WHERE track_family_id IS NOT NULL) AS distinct_families_on_album
  FROM album_track_base
  GROUP BY album_id
)
SELECT
  b.artist,
  b.album_id,
  b.album,
  b.edition,
  b.edition_is_canonical,
  b.track_family_id AS track_family,
  b.track_family_name,
  b.track_id,
  b.track_title,
  b.track_variant,
  concat_ws(
    '; ',
    CASE WHEN b.track_id IS NULL THEN 'album has no tracks' END,
    CASE WHEN b.track_family_id IS NULL THEN 'track not in track_family_members' END,
    CASE
      WHEN afs.distinct_families_on_album > 1 THEN 'multiple track families on one album'
    END,
    CASE
      WHEN b.is_primary_recording = false AND b.track_variant LIKE '%remaster%' THEN
        'probable remaster edition track'
    END,
    CASE
      WHEN b.is_primary_recording = false AND b.track_variant LIKE '%live%' THEN
        'live variant on album'
    END,
    CASE
      WHEN b.edition_is_canonical IS NOT TRUE AND b.edition <> '(no edition row)' THEN
        'non-canonical edition row'
    END
  ) AS lineage_notes
FROM album_track_base b
LEFT JOIN album_family_stats afs ON afs.album_id = b.album_id
ORDER BY b.artist, b.album, b.edition, b.track_id;
