-- 905_media_asset_candidate_generation.sql
-- Generate media_asset_link_candidates from VirtualDJ staging.

BEGIN;

DELETE FROM media_asset_link_candidates;

WITH vdj AS (
  SELECT
    v.id AS staging_id,
    v.source_path,
    v.filename,
    v.artist_text,
    v.title_text,
    v.album_text,
    v.duration_seconds,
    lower(trim(regexp_replace(coalesce(v.artist_text, ''), '\s+', ' ', 'g'))) AS norm_artist,
    lower(trim(regexp_replace(coalesce(v.title_text, ''), '\s+', ' ', 'g'))) AS norm_title,
    lower(trim(regexp_replace(coalesce(v.album_text, ''), '\s+', ' ', 'g'))) AS norm_album,
    lower(trim(coalesce(v.filename, ''))) AS norm_filename
  FROM staging_virtualdj_tracks v
  WHERE coalesce(trim(v.artist_text), '') <> ''
    AND coalesce(trim(v.title_text), '') <> ''
),
resolved AS (
  SELECT
    vdj.staging_id,
    a.id AS artist_id,
    t.id AS candidate_track_id,
    coalesce(tfm.track_family_id, tf.id) AS candidate_track_family_id,
    al.id AS candidate_album_id,
    (
      35
      + CASE WHEN lower(trim(t.title)) = vdj.norm_title THEN 40 ELSE 20 END
      + CASE
          WHEN vdj.duration_seconds IS NOT NULL AND t.duration_seconds IS NOT NULL
           AND abs(t.duration_seconds - vdj.duration_seconds) <= 3 THEN 10
          WHEN vdj.duration_seconds IS NOT NULL AND t.duration_seconds IS NOT NULL
           AND abs(t.duration_seconds - vdj.duration_seconds) <= 8 THEN 4
          ELSE 0
        END
      + CASE WHEN vdj.norm_filename LIKE '%' || vdj.norm_title || '%' THEN 5 ELSE 0 END
      + CASE WHEN al.id IS NOT NULL THEN 12 ELSE 0 END
    )::int AS confidence_score,
    trim(both ' + ' FROM concat_ws(' + ',
      'artist_exact',
      CASE WHEN lower(trim(t.title)) = vdj.norm_title THEN 'title_exact' ELSE 'title_fuzzy' END,
      CASE WHEN vdj.norm_filename LIKE '%' || vdj.norm_title || '%' THEN 'path_similarity' END,
      CASE
        WHEN vdj.duration_seconds IS NOT NULL AND t.duration_seconds IS NOT NULL
         AND abs(t.duration_seconds - vdj.duration_seconds) <= 8 THEN 'duration_support'
      END,
      CASE WHEN al.id IS NOT NULL THEN 'album_match' END
    )) AS match_reason
  FROM vdj
  JOIN artists a ON lower(trim(a.canonical_name)) = vdj.norm_artist
  JOIN LATERAL (
    SELECT t.*
    FROM tracks t
    WHERE t.artist_id = a.id
      AND (
        lower(trim(t.title)) = vdj.norm_title
        OR lower(trim(t.title)) LIKE vdj.norm_title || '%'
      )
    ORDER BY (lower(trim(t.title)) = vdj.norm_title) DESC, t.id
    LIMIT 1
  ) t ON true
  LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
  LEFT JOIN track_families tf
    ON tf.canonical_artist_id = a.id
   AND lower(trim(tf.canonical_name)) = vdj.norm_title
   AND tfm.track_family_id IS NULL
  LEFT JOIN albums al
    ON al.artist_id = a.id
   AND coalesce(vdj.norm_album, '') <> ''
   AND lower(trim(al.title)) = vdj.norm_album
)
INSERT INTO media_asset_link_candidates (
  staging_virtualdj_id,
  candidate_track_id,
  candidate_track_family_id,
  candidate_album_id,
  confidence_score,
  match_reason,
  review_flag
)
SELECT
  staging_id,
  candidate_track_id,
  candidate_track_family_id,
  candidate_album_id,
  confidence_score,
  match_reason,
  CASE
    WHEN confidence_score >= 88 THEN 'ok'
    WHEN confidence_score >= 65 THEN 'review_required'
    ELSE 'review_required'
  END
FROM resolved;

COMMIT;

SELECT review_flag, count(*) AS row_count
FROM media_asset_link_candidates
GROUP BY review_flag
ORDER BY row_count DESC;
