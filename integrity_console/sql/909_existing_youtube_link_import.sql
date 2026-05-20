-- 909_existing_youtube_link_import.sql
-- Import + candidate linkage for previously collected YouTube IDs.
--
-- Sources (export to CSV first):
--   /Users/bobhopp/Sites/retroverse/data/media/video_cache.json
--   /Users/bobhopp/Sites/retroverse/apps/music-browser/public/data/video_cache.json
--   /Users/bobhopp/Sites/retroverse/raw-data/youtube-reference.json (if present)
--
-- Quick export example:
--   python3 scripts/export_youtube_link_staging.py
--
-- Load buffer:
--   psql ... -c "\copy staging_youtube_link_import_buffer (
--     source_name, artist_text, title_text, youtube_url, youtube_video_id, content_hash
--   ) FROM 'exports/youtube/youtube_links.csv' CSV HEADER"

BEGIN;

INSERT INTO staging_youtube_link_imports (
  source_name,
  artist_text,
  title_text,
  youtube_url,
  youtube_video_id,
  content_hash
)
SELECT
  b.source_name,
  b.artist_text,
  b.title_text,
  b.youtube_url,
  b.youtube_video_id,
  b.content_hash
FROM staging_youtube_link_import_buffer b
WHERE coalesce(trim(b.content_hash), '') <> ''
ON CONFLICT (content_hash) DO NOTHING;

COMMIT;

-- Candidate linkage (read-only preview; does not insert youtube_track_links yet)
SELECT
  s.id AS staging_id,
  s.artist_text,
  s.title_text,
  s.youtube_url,
  s.youtube_video_id,
  t.id AS candidate_track_id,
  tfm.track_family_id AS candidate_track_family_id,
  CASE
    WHEN t.id IS NOT NULL AND lower(trim(t.title)) = lower(trim(s.title_text)) THEN 90
    WHEN t.id IS NOT NULL THEN 70
    ELSE 30
  END AS confidence_score,
  CASE
    WHEN t.id IS NOT NULL THEN 'ok'
    ELSE 'review_required'
  END AS review_flag
FROM staging_youtube_link_imports s
LEFT JOIN artists a
  ON lower(trim(a.canonical_name)) = lower(trim(regexp_replace(coalesce(s.artist_text, ''), '\s+', ' ', 'g')))
LEFT JOIN LATERAL (
  SELECT t.id, t.title
  FROM tracks t
  WHERE t.artist_id = a.id
    AND lower(trim(t.title)) = lower(trim(regexp_replace(coalesce(s.title_text, ''), '\s+', ' ', 'g')))
  ORDER BY t.id
  LIMIT 1
) t ON true
LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
ORDER BY confidence_score DESC
LIMIT 5000;
