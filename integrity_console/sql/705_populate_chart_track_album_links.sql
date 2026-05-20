-- 705_populate_chart_track_album_links.sql
-- Populate chart_track_album_links for Hot 100 only. Does not modify chart_appearances.

BEGIN;

WITH hot100 AS (
  SELECT
    ca.id AS chart_appearance_id,
    ca.track_id
  FROM chart_appearances ca
  WHERE ca.chart_name = 'Billboard Hot 100'
    AND ca.track_id IS NOT NULL
),
via_ctal_raw AS (
  SELECT
    h.chart_appearance_id,
    h.track_id,
    tfm.track_family_id,
    ctal.album_id,
    ctal.album_edition_id,
    ctal.confidence_score,
    ctal.source
  FROM hot100 h
  JOIN track_family_members tfm ON tfm.track_id = h.track_id
  JOIN canonical_track_album_links ctal ON ctal.track_family_id = tfm.track_family_id
  WHERE ctal.review_flag = 'ok'
),
via_ctal AS (
  SELECT
    r.*,
    g.album_match_count
  FROM via_ctal_raw r
  JOIN (
    SELECT chart_appearance_id, count(DISTINCT album_id)::int AS album_match_count
    FROM via_ctal_raw
    GROUP BY chart_appearance_id
  ) g ON g.chart_appearance_id = r.chart_appearance_id
),
via_track_album AS (
  SELECT
    h.chart_appearance_id,
    h.track_id,
    tfm.track_family_id,
    t.album_id,
    (
      SELECT ae.id FROM album_editions ae
      WHERE ae.album_id = t.album_id AND ae.is_canonical
      ORDER BY ae.id LIMIT 1
    ) AS album_edition_id,
    80 AS confidence_score,
    'tracks.album_id' AS source,
    1 AS album_match_count
  FROM hot100 h
  JOIN tracks t ON t.id = h.track_id
  LEFT JOIN track_family_members tfm ON tfm.track_id = h.track_id
  WHERE t.album_id IS NOT NULL
),
combined AS (
  SELECT * FROM via_ctal
  UNION ALL
  SELECT * FROM via_track_album
),
ranked AS (
  SELECT
    c.*,
    row_number() OVER (
      PARTITION BY c.chart_appearance_id
      ORDER BY c.confidence_score DESC, c.album_id
    ) AS rn
  FROM combined c
)
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
  r.chart_appearance_id,
  r.track_id,
  r.track_family_id,
  r.album_id,
  r.album_edition_id,
  r.confidence_score,
  r.source,
  CASE
    WHEN r.album_match_count > 1 THEN 'review_required'
    WHEN r.confidence_score >= 85 THEN 'ok'
    ELSE 'review_required'
  END
FROM ranked r
WHERE r.rn = 1
ON CONFLICT (chart_appearance_id) DO NOTHING;

COMMIT;

SELECT review_flag, count(*) AS row_count
FROM chart_track_album_links
GROUP BY review_flag
ORDER BY row_count DESC;
