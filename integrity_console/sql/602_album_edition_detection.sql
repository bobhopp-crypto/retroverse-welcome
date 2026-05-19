-- 602_album_edition_detection.sql
-- Detect probable album editions from Billboard staging titles. Read-only.

WITH distinct_titles AS (
  SELECT DISTINCT source_artist, source_album
  FROM staging_billboard_200_weekly
  WHERE source_album IS NOT NULL AND trim(source_album) <> ''
),
normalized AS (
  SELECT
    dt.*,
    lower(trim(regexp_replace(dt.source_album, '\s+', ' ', 'g'))) AS normalized_title_basic,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(trim(regexp_replace(dt.source_album, '\s+', ' ', 'g'))),
                '[''[\](){}]', ' ', 'g'
              ),
              '[–—−]', '-', 'g'
            ),
            '\s*[-]\s*(remastered?|deluxe|expanded|anniversary|special edition|live|bonus).*$',
            '',
            'gi'
          ),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS normalized_base_title
  FROM distinct_titles dt
)
SELECT
  n.source_album AS album_title,
  n.normalized_base_title,
  CASE
    WHEN n.source_album ~* 'soundtrack' THEN 'soundtrack'
    WHEN n.source_album ~* 'compilation|greatest hits|best of' THEN 'compilation'
    WHEN n.source_album ~* 'karaoke' THEN 'karaoke'
    WHEN n.source_album ~* '\mlive\M' THEN 'live'
    WHEN n.source_album ~* 'remaster|re-master' THEN 'remaster'
    WHEN n.source_album ~* 'deluxe' THEN 'deluxe'
    WHEN n.source_album ~* 'expanded' THEN 'expanded'
    WHEN n.source_album ~* 'anniversary' THEN 'anniversary'
    WHEN n.source_album ~* 'special edition' THEN 'special_edition'
    WHEN n.normalized_base_title = n.normalized_title_basic THEN 'studio'
    ELSE 'variant'
  END AS detected_edition_type,
  CASE
    WHEN n.source_album ~* 'soundtrack|compilation|greatest hits|best of' THEN 95
    WHEN n.source_album ~* 'remaster|re-master' THEN 85
    WHEN n.source_album ~* 'deluxe|expanded|anniversary' THEN 80
    WHEN n.source_album ~* '\mlive\M' THEN 75
    ELSE 70
  END AS edition_confidence,
  CASE
    WHEN n.source_album ~* 'soundtrack|compilation|\mlive\M' THEN 'preserve_separately'
    WHEN n.source_album ~* 'remaster|deluxe|expanded|anniversary' THEN 'preserve_as_edition'
    ELSE 'canonical_base_candidate'
  END AS preservation_recommendation
FROM normalized n
ORDER BY n.source_artist, n.normalized_base_title, n.source_album
LIMIT 10000;
