-- 1003_populate_album_artwork_links.sql
-- Populate artwork links from staging buffer. Does not overwrite curated rows.
--
-- \copy staging_album_artwork_link_buffer (
--   album_id, album_edition_id, canonical_cover_path, local_cover_path,
--   r2_cover_key, source, confidence_score, review_flag
-- ) FROM 'exports/graph/album_artwork_links.csv' CSV HEADER

BEGIN;

INSERT INTO album_artwork_links (
  album_id,
  album_edition_id,
  canonical_cover_path,
  local_cover_path,
  r2_cover_key,
  source,
  confidence_score,
  review_flag
)
SELECT
  b.album_id::bigint,
  NULLIF(trim(b.album_edition_id), '')::bigint,
  NULLIF(trim(b.canonical_cover_path), ''),
  NULLIF(trim(b.local_cover_path), ''),
  NULLIF(trim(b.r2_cover_key), ''),
  coalesce(nullif(trim(b.source), ''), 'import'),
  NULLIF(trim(b.confidence_score), '')::int,
  coalesce(nullif(trim(b.review_flag), ''), 'pending')
FROM staging_album_artwork_link_buffer b
WHERE b.album_id ~ '^[0-9]+$'
  AND NOT EXISTS (
    SELECT 1 FROM album_artwork_links aal
    WHERE aal.album_id = b.album_id::bigint
      AND aal.review_flag IN ('curated', 'ok')
      AND aal.source IN ('curator', 'curator_override', 'manual')
  )
ON CONFLICT (album_id, coalesce(album_edition_id, 0), source) DO NOTHING;

-- Backfill albums.canonical_cover_path only where empty (non-destructive).
UPDATE albums al
SET canonical_cover_path = sub.canonical_cover_path
FROM (
  SELECT DISTINCT ON (aal.album_id)
    aal.album_id,
    aal.canonical_cover_path
  FROM album_artwork_links aal
  WHERE coalesce(aal.canonical_cover_path, '') <> ''
  ORDER BY aal.album_id, (aal.review_flag = 'curated') DESC, aal.confidence_score DESC NULLS LAST
) sub
WHERE al.id = sub.album_id
  AND coalesce(al.canonical_cover_path, '') = '';

COMMIT;

SELECT
  (SELECT count(*)::int FROM album_artwork_links) AS artwork_links,
  (SELECT count(*)::int FROM albums WHERE coalesce(canonical_cover_path, '') <> '') AS albums_with_cover_path;
