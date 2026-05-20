-- 804_acoustic_track_album_candidate_generation.sql
-- Generate acoustic_track_album_candidates from staging_acoustic_tracks.
-- Preserves same song on multiple albums. Exact artist + album + title matching.

BEGIN;

DELETE FROM acoustic_track_album_candidates;

WITH staging_norm AS (
  SELECT
    sat.id AS staging_acoustic_id,
    sat.source_artist,
    sat.source_album,
    sat.source_song,
    sat.source_duration,
    lower(trim(regexp_replace(sat.source_artist, '\s+', ' ', 'g'))) AS norm_artist,
    lower(trim(regexp_replace(sat.source_album, '\s+', ' ', 'g'))) AS norm_album,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              lower(trim(regexp_replace(sat.source_song, '\s+', ' ', 'g'))),
              '[''[\](){}]', ' ', 'g'
            ),
            '[–—−]', '-', 'g'
          ),
          '\s+', ' ', 'g'
        )
      )
    ) AS norm_song
  FROM staging_acoustic_tracks sat
),
multi_album AS (
  SELECT
    lower(trim(source_artist)) AS na,
    lower(trim(source_song)) AS ns,
    count(DISTINCT source_album)::int AS album_variants
  FROM staging_acoustic_tracks
  GROUP BY 1, 2
),
resolved AS (
  SELECT
    sn.staging_acoustic_id,
    sn.source_artist,
    sn.source_album,
    sn.source_song,
    sn.source_duration,
    a.id AS canonical_artist_id,
    t.id AS track_id,
    coalesce(tfm.track_family_id, tf.id) AS track_family_id,
    al.id AS album_id,
    ae.id AS album_edition_id,
    (
      30
      + CASE WHEN t.id IS NOT NULL THEN 40 ELSE 0 END
      + CASE WHEN coalesce(tfm.track_family_id, tf.id) IS NOT NULL THEN 10 ELSE 0 END
      + CASE WHEN r.album_id IS NOT NULL THEN 25 WHEN al.id IS NOT NULL THEN 20 ELSE 0 END
      + CASE
          WHEN t.duration_seconds IS NOT NULL AND sn.source_duration IS NOT NULL
           AND abs(t.duration_seconds - sn.source_duration) <= 3 THEN 8
          WHEN t.duration_seconds IS NOT NULL AND sn.source_duration IS NOT NULL
           AND abs(t.duration_seconds - sn.source_duration) <= 8 THEN 3
          ELSE 0
        END
    )::int AS confidence_score,
    trim(both ' + ' FROM concat_ws(' + ',
      'artist_exact',
      CASE WHEN t.id IS NOT NULL THEN 'title_exact' END,
      CASE WHEN al.id IS NOT NULL THEN 'album_match' END,
      CASE
        WHEN t.duration_seconds IS NOT NULL AND sn.source_duration IS NOT NULL
         AND abs(t.duration_seconds - sn.source_duration) <= 8 THEN 'duration_support'
      END,
      CASE WHEN coalesce(tfm.track_family_id, tf.id) IS NOT NULL THEN 'family' END
    )) AS match_reason,
    coalesce(ma.album_variants, 1) AS album_variants
  FROM staging_norm sn
  LEFT JOIN artists a ON lower(trim(a.canonical_name)) = sn.norm_artist
  LEFT JOIN album_population_registry r
    ON r.canonical_artist_id = a.id
   AND lower(trim(r.canonical_album_name)) = sn.norm_album
  LEFT JOIN albums al
    ON al.artist_id = a.id
   AND (
     (r.album_id IS NOT NULL AND al.id = r.album_id)
     OR (r.album_id IS NULL AND lower(trim(al.title)) = sn.norm_album)
   )
  LEFT JOIN LATERAL (
    SELECT id FROM album_editions
    WHERE album_id = al.id
    ORDER BY is_canonical DESC, id
    LIMIT 1
  ) ae ON al.id IS NOT NULL
  LEFT JOIN LATERAL (
    SELECT t.id, t.duration_seconds
    FROM tracks t
    WHERE t.artist_id = a.id
      AND lower(trim(t.title)) = sn.norm_song
    ORDER BY t.id
    LIMIT 1
  ) t ON a.id IS NOT NULL
  LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
  LEFT JOIN track_families tf
    ON tf.canonical_artist_id = a.id
   AND lower(trim(tf.canonical_name)) = sn.norm_song
   AND t.id IS NULL
  LEFT JOIN multi_album ma
    ON ma.na = lower(trim(sn.source_artist))
   AND ma.ns = sn.norm_song
  WHERE a.id IS NOT NULL
    AND al.id IS NOT NULL
)
INSERT INTO acoustic_track_album_candidates (
  staging_acoustic_id,
  canonical_artist_id,
  track_id,
  track_family_id,
  album_id,
  album_edition_id,
  confidence_score,
  match_reason,
  review_flag
)
SELECT
  staging_acoustic_id,
  canonical_artist_id,
  track_id,
  track_family_id,
  album_id,
  album_edition_id,
  confidence_score,
  match_reason,
  CASE
    WHEN album_variants > 1 THEN 'review_required'
    WHEN confidence_score >= 85 AND track_family_id IS NOT NULL THEN 'ok'
    WHEN confidence_score >= 70 THEN 'review_required'
    ELSE 'review_required'
  END
FROM resolved;

COMMIT;

SELECT review_flag, count(*) AS row_count
FROM acoustic_track_album_candidates
GROUP BY review_flag
ORDER BY row_count DESC;
