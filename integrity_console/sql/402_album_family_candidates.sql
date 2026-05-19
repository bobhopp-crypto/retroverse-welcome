-- 402_album_family_candidates.sql
-- Canonical album family candidates. Read-only.

WITH normalized AS (
  SELECT
    al.id AS album_id,
    al.artist_id,
    a.canonical_name AS artist,
    al.title AS original_title,
    lower(trim(regexp_replace(al.title, '\s+', ' ', 'g'))) AS normalized_title_basic,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(trim(regexp_replace(al.title, '\s+', ' ', 'g'))),
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
    ) AS normalized_title_aggressive,
    (al.title ~* 'soundtrack') AS is_soundtrack,
    (al.title ~* 'compilation|greatest hits|best of') AS is_compilation,
    (al.title ~* 'deluxe|expanded|anniversary|special edition') AS is_special_edition,
    (al.title ~* 'remaster|re-master') AS has_remaster,
    (al.title ~* '\mlive\M') AS has_live
  FROM albums al
  JOIN artists a ON a.id = al.artist_id
),
family_keys AS (
  SELECT
    n.*,
    CASE
      WHEN n.is_soundtrack THEN
        n.artist_id::text || '::soundtrack::' || n.normalized_title_basic
      WHEN n.is_compilation THEN
        n.artist_id::text || '::compilation::' || n.normalized_title_basic
      WHEN n.has_live AND n.original_title ~* 'live' THEN
        n.artist_id::text || '::live_album::' || n.normalized_title_basic
      ELSE
        n.artist_id::text || '::' || coalesce(nullif(n.normalized_title_aggressive, ''), n.normalized_title_basic)
    END AS proposed_album_family_key
  FROM normalized n
),
grouped AS (
  SELECT
    proposed_album_family_key,
    min(artist) AS artist,
    min(artist_id) AS artist_id,
    count(*) AS album_count,
    count(*) FILTER (WHERE is_special_edition OR has_remaster OR has_live) AS edition_like_count,
    array_agg(album_id ORDER BY album_id) AS candidate_album_ids
  FROM family_keys
  GROUP BY proposed_album_family_key
),
ranked AS (
  SELECT
    fk.*,
    g.album_count,
    g.candidate_album_ids,
    row_number() OVER (
      PARTITION BY fk.proposed_album_family_key
      ORDER BY
        (NOT (fk.has_remaster OR fk.has_live OR fk.is_special_edition)) DESC,
        length(fk.original_title) ASC,
        fk.album_id ASC
    ) AS family_rank
  FROM family_keys fk
  JOIN grouped g ON g.proposed_album_family_key = fk.proposed_album_family_key
)
SELECT
  g.proposed_album_family_key,
  canon.original_title AS canonical_album_name,
  g.artist,
  coalesce(
    (SELECT count(*)::int FROM album_editions ae WHERE ae.album_id = ANY (g.candidate_album_ids)),
    0
  ) AS edition_count,
  g.candidate_album_ids,
  least(100, greatest(0,
    40
    + CASE WHEN g.album_count > 1 THEN 25 ELSE 10 END
    + CASE WHEN g.edition_like_count > 0 AND g.album_count > 1 THEN 15 ELSE 5 END
    + CASE WHEN canon.is_soundtrack OR canon.is_compilation THEN 10 ELSE 0 END
  ))::int AS confidence
FROM grouped g
JOIN ranked canon
  ON canon.proposed_album_family_key = g.proposed_album_family_key
 AND canon.family_rank = 1
ORDER BY g.album_count DESC, g.proposed_album_family_key;
