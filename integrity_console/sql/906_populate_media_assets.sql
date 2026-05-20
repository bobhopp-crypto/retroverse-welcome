-- 906_populate_media_assets.sql
-- Populate media_assets + media_track_links from VirtualDJ staging.
-- Additive, idempotent. Does not overwrite existing assets.

BEGIN;

INSERT INTO media_assets (
  source_system,
  source_path,
  filename,
  directory_path,
  file_extension,
  artist_text,
  title_text,
  album_text,
  genre_text,
  year_text,
  duration_seconds,
  play_count,
  last_played,
  file_size,
  content_hash,
  vdj_guid,
  local_thumbnail_path,
  r2_media_key,
  r2_thumbnail_key
)
SELECT
  'virtualdj',
  v.source_path,
  v.filename,
  regexp_replace(v.source_path, '[^/]+$',''),
  lower(regexp_replace(coalesce(v.filename, ''), '^.*\.', '')),
  v.artist_text,
  v.title_text,
  v.album_text,
  v.genre_text,
  v.year_text,
  v.duration_seconds,
  v.play_count,
  v.last_played,
  v.file_size,
  v.content_hash,
  v.vdj_guid,
  v.thumbnail_path,
  CASE
    WHEN v.source_path ~* '^/Users/bobhopp/DJ MEDIA/VIDEO/'
      THEN 'video/' || regexp_replace(
        regexp_replace(trim(both '/' FROM substring(v.source_path FROM 'VIDEO/(.+)$')), ' ', '%20', 'g'),
        '''', '%27', 'g'
      )
    WHEN v.source_path ~* '\.(mp4|mov|m4v)$'
      THEN 'video/' || regexp_replace(v.filename, ' ', '%20', 'g')
    ELSE NULL
  END,
  CASE
    WHEN coalesce(v.thumbnail_path, '') <> '' AND v.thumbnail_path ~* '^https?://'
      THEN 'thumbnails/vdj/' || v.filepath_hash || '.jpg'
    ELSE NULL
  END
FROM staging_virtualdj_tracks v
WHERE NOT EXISTS (
  SELECT 1 FROM media_assets ma
  WHERE ma.content_hash = v.content_hash
     OR (ma.vdj_guid IS NOT NULL AND ma.vdj_guid = v.vdj_guid)
     OR (ma.source_path IS NOT NULL AND ma.source_path = v.source_path)
)
ON CONFLICT DO NOTHING;

INSERT INTO media_track_links (
  media_asset_id,
  track_id,
  track_family_id,
  confidence_score,
  match_reason,
  review_flag
)
SELECT
  ma.id,
  c.candidate_track_id,
  c.candidate_track_family_id,
  c.confidence_score,
  c.match_reason,
  c.review_flag
FROM media_asset_link_candidates c
JOIN staging_virtualdj_tracks v ON v.id = c.staging_virtualdj_id
JOIN media_assets ma ON ma.content_hash = v.content_hash
WHERE c.candidate_track_id IS NOT NULL
  AND c.review_flag IN ('ok', 'review_required')
  AND NOT EXISTS (
    SELECT 1 FROM media_track_links mtl
    WHERE mtl.media_asset_id = ma.id
      AND coalesce(mtl.track_id, 0) = coalesce(c.candidate_track_id, 0)
  )
ON CONFLICT DO NOTHING;

COMMIT;

SELECT
  (SELECT count(*) FROM media_assets WHERE source_system = 'virtualdj') AS vdj_media_assets,
  (SELECT count(*) FROM media_track_links) AS media_track_links;
