-- 704_hot100_to_album_linkage_candidates.sql
-- Hot 100 chart appearances → album context candidates. Read-only.

WITH hot100 AS (
  SELECT
    ca.id AS chart_appearance_id,
    ca.chart_date,
    ca.chart_position,
    ca.track_id,
    a.canonical_name AS artist,
    t.title AS track_title
  FROM chart_appearances ca
  JOIN tracks t ON t.id = ca.track_id
  JOIN artists a ON a.id = t.artist_id
  WHERE ca.chart_name = 'Billboard Hot 100'
    AND ca.track_id IS NOT NULL
),
via_ctal_raw AS (
  SELECT
    h.chart_appearance_id,
    h.chart_date,
    h.chart_position,
    h.artist,
    h.track_title,
    ctal.album_id,
    al.title AS album_title,
    ctal.album_edition_id,
    ctal.confidence_score,
    ctal.source
  FROM hot100 h
  JOIN track_family_members tfm ON tfm.track_id = h.track_id
  JOIN canonical_track_album_links ctal ON ctal.track_family_id = tfm.track_family_id
  JOIN albums al ON al.id = ctal.album_id
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
    h.chart_date,
    h.chart_position,
    h.artist,
    h.track_title,
    t.album_id,
    al.title AS album_title,
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
  JOIN albums al ON al.id = t.album_id
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
SELECT
  chart_appearance_id,
  chart_date,
  chart_position,
  artist,
  track_title,
  album_id,
  album_title,
  confidence_score,
  CASE
    WHEN album_match_count > 1 THEN 'review_required'
    WHEN confidence_score >= 85 THEN 'ok'
    ELSE 'review_required'
  END AS review_flag
FROM ranked
WHERE rn = 1
ORDER BY chart_date DESC, chart_position
LIMIT 10000;
