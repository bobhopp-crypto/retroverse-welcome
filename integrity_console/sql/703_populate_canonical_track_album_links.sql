-- 703_populate_canonical_track_album_links.sql
-- Populate canonical_track_album_links. Additive, idempotent.

BEGIN;

WITH from_lineage AS (
  SELECT
    atl.track_family_id,
    atl.album_id,
    atl.album_edition_id,
    'appears_on' AS relationship_type,
    atl.track_number,
    coalesce(atl.disc_number, 1) AS disc_number,
    90 AS confidence_score,
    atl.source_provenance AS source
  FROM album_track_lineage atl
  WHERE atl.track_family_id IS NOT NULL AND atl.album_id IS NOT NULL
),
from_track_album AS (
  SELECT
    tfm.track_family_id,
    t.album_id,
    (
      SELECT ae.id FROM album_editions ae
      WHERE ae.album_id = t.album_id AND ae.is_canonical
      ORDER BY ae.id LIMIT 1
    ) AS album_edition_id,
    'appears_on' AS relationship_type,
    t.track_number,
    1 AS disc_number,
    85 AS confidence_score,
    'tracks.album_id' AS source
  FROM tracks t
  JOIN track_family_members tfm ON tfm.track_id = t.id
  WHERE t.album_id IS NOT NULL
),
from_mb_staging AS (
  SELECT
    tf.id AS track_family_id,
    al.id AS album_id,
    ae.id AS album_edition_id,
    'appears_on' AS relationship_type,
    st.track_number,
    coalesce(st.disc_number, 1) AS disc_number,
    80 AS confidence_score,
    st.source_name AS source
  FROM staging_album_tracklist_imports st
  JOIN artists a ON lower(trim(a.canonical_name)) = lower(trim(st.source_artist))
  JOIN albums al
    ON al.artist_id = a.id
   AND lower(trim(al.title)) = lower(trim(st.source_album))
  LEFT JOIN album_editions ae
    ON ae.album_id = al.id
   AND lower(trim(ae.edition_name)) = lower(trim(coalesce(st.edition_name, st.source_album)))
  JOIN track_families tf
    ON tf.canonical_artist_id = a.id
   AND lower(trim(tf.canonical_name)) = lower(trim(st.track_title))
),
combined AS (
  SELECT * FROM from_lineage
  UNION ALL
  SELECT * FROM from_track_album
  UNION ALL
  SELECT * FROM from_mb_staging
),
family_album_counts AS (
  SELECT track_family_id, count(DISTINCT album_id)::int AS family_album_count
  FROM combined
  GROUP BY track_family_id
),
ranked AS (
  SELECT
    c.*,
    fac.family_album_count,
    row_number() OVER (
      PARTITION BY c.track_family_id, c.album_id, coalesce(c.album_edition_id, 0), c.source
      ORDER BY c.confidence_score DESC
    ) AS rn
  FROM combined c
  JOIN family_album_counts fac ON fac.track_family_id = c.track_family_id
)
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
  r.track_family_id,
  r.album_id,
  r.album_edition_id,
  r.relationship_type,
  r.track_number,
  r.disc_number,
  r.confidence_score,
  r.source,
  CASE
    WHEN r.confidence_score >= 85 AND r.family_album_count = 1 THEN 'ok'
    WHEN r.confidence_score >= 85 THEN 'review_required'
    ELSE 'review_required'
  END
FROM ranked r
WHERE r.rn = 1
ON CONFLICT DO NOTHING;

UPDATE canonical_track_album_links ctal
SET review_flag = 'ok'
WHERE ctal.confidence_score >= 85
  AND ctal.review_flag = 'review_required'
  AND (
    SELECT count(DISTINCT x.album_id)
    FROM canonical_track_album_links x
    WHERE x.track_family_id = ctal.track_family_id
  ) = 1;

COMMIT;

SELECT review_flag, count(*) AS row_count
FROM canonical_track_album_links
GROUP BY review_flag
ORDER BY row_count DESC;
