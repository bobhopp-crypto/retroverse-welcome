-- 907_r2_asset_linkage_analysis.sql
-- R2 sync analysis from local paths (no Cloudflare API calls). Read-only output.

WITH assets AS (
  SELECT
    ma.id,
    ma.source_path,
    ma.filename,
    ma.artist_text,
    ma.title_text,
    ma.r2_media_key,
    ma.r2_thumbnail_key,
    ma.local_thumbnail_path,
    CASE
      WHEN ma.source_path ~* '^/Users/bobhopp/DJ MEDIA/VIDEO/'
        THEN 'video/' || regexp_replace(
          regexp_replace(trim(both '/' FROM substring(ma.source_path FROM 'VIDEO/(.+)$')), ' ', '%20', 'g'),
          '''', '%27', 'g'
        )
      WHEN ma.source_path ~* '\.(mp4|mov|m4v)$' AND ma.filename IS NOT NULL
        THEN 'video/' || regexp_replace(ma.filename, ' ', '%20', 'g')
      ELSE NULL
    END AS probable_r2_media_key,
    CASE
      WHEN coalesce(ma.local_thumbnail_path, '') <> '' THEN true
      WHEN coalesce(ma.r2_thumbnail_key, '') <> '' THEN true
      ELSE false
    END AS has_thumbnail_ref
  FROM media_assets ma
  WHERE ma.source_system = 'virtualdj'
),
enriched AS (
  SELECT
    a.*,
    coalesce(a.r2_media_key, a.probable_r2_media_key) AS probable_r2_media_key_final,
    CASE
      WHEN a.r2_media_key IS NOT NULL THEN 'linked'
      WHEN a.probable_r2_media_key IS NOT NULL THEN 'probable'
      ELSE 'missing_r2_asset'
    END AS sync_status,
    CASE
      WHEN a.r2_thumbnail_key IS NOT NULL THEN false
      WHEN a.has_thumbnail_ref THEN true
      ELSE true
    END AS missing_thumbnail
  FROM assets a
)
SELECT
  id,
  artist_text,
  title_text,
  source_path,
  probable_r2_media_key_final AS probable_r2_media_key,
  r2_thumbnail_key AS probable_r2_thumbnail_key,
  missing_thumbnail,
  (sync_status = 'missing_r2_asset') AS missing_r2_asset,
  sync_status
FROM enriched
ORDER BY sync_status, artist_text, title_text
LIMIT 5000;
