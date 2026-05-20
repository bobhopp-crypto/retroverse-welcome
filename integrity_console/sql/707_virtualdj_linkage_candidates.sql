-- 707_virtualdj_linkage_candidates.sql
-- Candidate VDJ staging → track / family / album matches. Read-only.
-- Safe when staging_virtualdj_tracks is empty.

WITH staging_norm AS (
  SELECT
    v.id AS vdj_staging_id,
    v.source_path,
    v.filename,
    v.artist_text,
    v.title_text,
    v.album_text,
    v.duration_seconds,
    lower(trim(regexp_replace(coalesce(v.artist_text, ''), '\s+', ' ', 'g'))) AS norm_artist,
    lower(trim(regexp_replace(coalesce(v.title_text, ''), '\s+', ' ', 'g'))) AS norm_title,
    lower(trim(regexp_replace(coalesce(v.album_text, ''), '\s+', ' ', 'g'))) AS norm_album
  FROM staging_virtualdj_tracks v
),
track_match AS (
  SELECT
    sn.vdj_staging_id,
    sn.source_path,
    sn.artist_text,
    sn.title_text,
    t.id AS candidate_track_id,
    tfm.track_family_id AS candidate_track_family_id,
    t.album_id AS candidate_album_id,
    CASE
      WHEN lower(trim(a.canonical_name)) = sn.norm_artist
       AND lower(trim(t.title)) = sn.norm_title THEN 95
      WHEN lower(trim(t.title)) = sn.norm_title THEN 75
      ELSE 55
    END AS confidence_score,
    CASE
      WHEN lower(trim(a.canonical_name)) = sn.norm_artist
       AND lower(trim(t.title)) = sn.norm_title THEN 'artist_title_exact'
      WHEN lower(trim(t.title)) = sn.norm_title THEN 'title_exact'
      ELSE 'title_fuzzy'
    END AS match_reason,
    row_number() OVER (
      PARTITION BY sn.vdj_staging_id
      ORDER BY
        (lower(trim(a.canonical_name)) = sn.norm_artist AND lower(trim(t.title)) = sn.norm_title) DESC,
        (lower(trim(t.title)) = sn.norm_title) DESC,
        t.id
    ) AS rn
  FROM staging_norm sn
  JOIN tracks t ON lower(trim(t.title)) = sn.norm_title
  LEFT JOIN artists a ON a.id = t.artist_id
  LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
  WHERE sn.norm_title <> ''
),
album_boost AS (
  SELECT
    tm.*,
    CASE
      WHEN tm.candidate_album_id IS NOT NULL
       AND sn.norm_album <> ''
       AND lower(trim(al.title)) = sn.norm_album THEN tm.confidence_score + 5
      ELSE tm.confidence_score
    END AS confidence_adj
  FROM track_match tm
  JOIN staging_norm sn ON sn.vdj_staging_id = tm.vdj_staging_id
  LEFT JOIN albums al ON al.id = tm.candidate_album_id
  WHERE tm.rn = 1
),
duration_check AS (
  SELECT
    ab.*,
    sn.duration_seconds AS vdj_duration,
    t.duration_seconds AS track_duration,
    CASE
      WHEN ab.confidence_adj >= 90
       AND sn.duration_seconds IS NOT NULL
       AND t.duration_seconds IS NOT NULL
       AND abs(sn.duration_seconds - t.duration_seconds) <= 5 THEN ab.confidence_adj + 3
      WHEN sn.duration_seconds IS NOT NULL
       AND t.duration_seconds IS NOT NULL
       AND abs(sn.duration_seconds - t.duration_seconds) > 15 THEN ab.confidence_adj - 15
      ELSE ab.confidence_adj
    END AS confidence_final
  FROM album_boost ab
  JOIN staging_norm sn ON sn.vdj_staging_id = ab.vdj_staging_id
  LEFT JOIN tracks t ON t.id = ab.candidate_track_id
)
SELECT
  vdj_staging_id,
  source_path,
  artist_text,
  title_text,
  candidate_track_id,
  candidate_track_family_id,
  candidate_album_id,
  confidence_final AS confidence_score,
  match_reason,
  CASE
    WHEN confidence_final >= 90 THEN 'ok'
    WHEN confidence_final >= 70 THEN 'review_required'
    ELSE 'review_required'
  END AS review_flag
FROM duration_check
ORDER BY confidence_final DESC, vdj_staging_id
LIMIT 10000;
