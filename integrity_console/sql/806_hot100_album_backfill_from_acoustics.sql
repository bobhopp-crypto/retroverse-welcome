-- 806_hot100_album_backfill_from_acoustics.sql
-- Backfill chart_track_album_links for Hot 100 via acoustics-derived canonical_track_album_links.
-- Does not modify chart_appearances. Additive, idempotent.

BEGIN;

INSERT INTO chart_track_album_links (
  chart_appearance_id,
  track_id,
  track_family_id,
  album_id,
  album_edition_id,
  confidence_score,
  source,
  review_flag
)
SELECT
  pick.chart_appearance_id,
  pick.track_id,
  pick.track_family_id,
  pick.album_id,
  pick.album_edition_id,
  pick.confidence_score,
  'acoustics_hot100_backfill',
  pick.review_flag
FROM (
  SELECT DISTINCT ON (ca.id)
    ca.id AS chart_appearance_id,
    ca.track_id,
    ctal.track_family_id,
    ctal.album_id,
    ctal.album_edition_id,
    ctal.confidence_score,
    CASE
      WHEN album_pick.cnt > 1 THEN 'review_required'
      ELSE 'ok'
    END AS review_flag
  FROM chart_appearances ca
  JOIN track_family_members tfm ON tfm.track_id = ca.track_id
  JOIN canonical_track_album_links ctal
    ON ctal.track_family_id = tfm.track_family_id
   AND ctal.source = 'acoustics'
   AND ctal.review_flag = 'ok'
  JOIN (
    SELECT tfm2.track_id, count(DISTINCT c2.album_id)::int AS cnt
    FROM chart_appearances ca2
    JOIN track_family_members tfm2 ON tfm2.track_id = ca2.track_id
    JOIN canonical_track_album_links c2
      ON c2.track_family_id = tfm2.track_family_id
     AND c2.source = 'acoustics'
     AND c2.review_flag = 'ok'
    WHERE ca2.chart_name = 'Billboard Hot 100'
    GROUP BY tfm2.track_id
  ) album_pick ON album_pick.track_id = ca.track_id
  WHERE ca.chart_name = 'Billboard Hot 100'
    AND ca.track_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM chart_track_album_links l WHERE l.chart_appearance_id = ca.id
    )
  ORDER BY ca.id, ctal.confidence_score DESC, ctal.album_id
) pick;

COMMIT;

SELECT
  source,
  review_flag,
  count(*) AS row_count
FROM chart_track_album_links
WHERE source = 'acoustics_hot100_backfill'
GROUP BY source, review_flag;
