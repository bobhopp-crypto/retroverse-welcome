-- 702_album_tracklist_linkage_candidates.sql
-- Candidate track_family ↔ album/edition links. Read-only.

WITH from_lineage AS (
  SELECT
    atl.album_id,
    al.title AS album_name,
    atl.album_edition_id,
    atl.track_family_id,
    tf.canonical_name AS track_name,
    atl.track_number,
    atl.disc_number,
    90 AS confidence_score,
    atl.source_provenance AS source,
    CASE
      WHEN atl.track_family_id IS NULL THEN 'review_required'
      WHEN atl.album_id IS NULL THEN 'review_required'
      ELSE 'ok'
    END AS review_flag
  FROM album_track_lineage atl
  JOIN albums al ON al.id = atl.album_id
  LEFT JOIN track_families tf ON tf.id = atl.track_family_id
  WHERE atl.album_id IS NOT NULL
    AND atl.track_family_id IS NOT NULL
),
from_track_album AS (
  SELECT
    t.album_id,
    al.title AS album_name,
    (
      SELECT ae.id FROM album_editions ae
      WHERE ae.album_id = t.album_id AND ae.is_canonical
      ORDER BY ae.id LIMIT 1
    ) AS album_edition_id,
    tfm.track_family_id,
    tf.canonical_name AS track_name,
    t.track_number,
    1 AS disc_number,
    85 AS confidence_score,
    'tracks.album_id' AS source,
    'ok' AS review_flag
  FROM tracks t
  JOIN albums al ON al.id = t.album_id
  JOIN track_family_members tfm ON tfm.track_id = t.id
  JOIN track_families tf ON tf.id = tfm.track_family_id
  WHERE t.album_id IS NOT NULL
),
from_mb_staging AS (
  SELECT
    al.id AS album_id,
    al.title AS album_name,
    ae.id AS album_edition_id,
    tf.id AS track_family_id,
    st.track_title AS track_name,
    st.track_number,
    coalesce(st.disc_number, 1) AS disc_number,
    80 AS confidence_score,
    st.source_name AS source,
    CASE
      WHEN tf.id IS NULL THEN 'review_required'
      WHEN al.id IS NULL THEN 'review_required'
      ELSE 'ok'
    END AS review_flag
  FROM staging_album_tracklist_imports st
  LEFT JOIN artists a ON lower(trim(a.canonical_name)) = lower(trim(st.source_artist))
  LEFT JOIN albums al
    ON al.artist_id = a.id
   AND lower(trim(al.title)) = lower(trim(st.source_album))
  LEFT JOIN album_editions ae
    ON ae.album_id = al.id
   AND lower(trim(ae.edition_name)) = lower(trim(coalesce(st.edition_name, st.source_album)))
  LEFT JOIN track_families tf
    ON tf.canonical_artist_id = a.id
   AND lower(trim(tf.canonical_name)) = lower(trim(st.track_title))
  WHERE al.id IS NOT NULL
),
combined AS (
  SELECT * FROM from_lineage
  UNION ALL
  SELECT * FROM from_track_album
  UNION ALL
  SELECT * FROM from_mb_staging
),
deduped AS (
  SELECT DISTINCT ON (track_family_id, album_id, coalesce(album_edition_id, 0), source)
    album_id,
    album_name,
    album_edition_id,
    track_family_id,
    track_name,
    track_number,
    disc_number,
    confidence_score,
    source,
    review_flag
  FROM combined
  WHERE track_family_id IS NOT NULL AND album_id IS NOT NULL
  ORDER BY track_family_id, album_id, coalesce(album_edition_id, 0), source, confidence_score DESC
)
SELECT
  album_id,
  album_name,
  album_edition_id,
  track_family_id,
  track_name,
  track_number,
  disc_number,
  confidence_score,
  source,
  review_flag
FROM deduped
ORDER BY confidence_score DESC, album_name, track_number NULLS LAST
LIMIT 10000;
