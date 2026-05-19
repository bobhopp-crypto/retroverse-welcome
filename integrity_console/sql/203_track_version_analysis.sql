-- 203_track_version_analysis.sql
-- Classify track variants without merging. Read-only.

WITH base AS (
  SELECT
    t.id AS track_id,
    t.artist_id,
    t.title AS original_title,
    lower(trim(regexp_replace(t.title, '\s+', ' ', 'g'))) AS normalized_title_basic,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                lower(trim(regexp_replace(t.title, '\s+', ' ', 'g'))),
                '[''[\](){}]', ' ', 'g'
              ),
              '[–—−]', '-', 'g'
            ),
            '\m(feat\.?|featuring|ft\.?)\M', ' feat ', 'gi'
          ),
          '\s*[-]\s*(remastered?|live|radio edit|mono|stereo|explicit|clean|instrumental|karaoke|acoustic|extended mix|remix).*$',
          '',
          'gi'
        )
      )
    ) AS normalized_base_title
  FROM tracks t
),
typed AS (
  SELECT
    b.*,
    CASE
      WHEN original_title ~* 'medley' THEN 'medley'
      WHEN original_title ~* 'karaoke' THEN 'karaoke'
      WHEN original_title ~* 'instrumental' THEN 'instrumental'
      WHEN original_title ~* 'remix' THEN 'remix'
      WHEN original_title ~* '\mlive\M' THEN 'live'
      WHEN original_title ~* 'acoustic' THEN 'acoustic'
      WHEN original_title ~* 'extended\s*mix' THEN 'extended_mix'
      WHEN original_title ~* 'radio\s*edit' THEN 'radio_edit'
      WHEN original_title ~* 'remaster|re-master' THEN 'remaster'
      WHEN original_title ~* '\mmono\M' THEN 'mono'
      WHEN original_title ~* '\mstereo\M' THEN 'stereo'
      WHEN original_title ~* 'explicit' THEN 'explicit'
      WHEN original_title ~* '\mclean\M' THEN 'clean'
      WHEN original_title ~* '\m(feat\.?|featuring|ft\.?)\M' THEN 'featured'
      ELSE 'studio'
    END AS detected_version_type,
    coalesce(b.artist_id::text, 'unknown') || '::' || coalesce(b.normalized_base_title, '') AS canonical_candidate_key
  FROM base b
),
group_context AS (
  SELECT
    canonical_candidate_key,
    count(*) AS variant_count,
    count(*) FILTER (WHERE detected_version_type = 'studio') AS studio_count
  FROM typed
  GROUP BY canonical_candidate_key
)
SELECT
  t.track_id,
  t.canonical_candidate_key,
  t.original_title,
  t.detected_version_type,
  t.normalized_base_title,
  CASE
    WHEN t.detected_version_type IN ('live', 'remix', 'medley', 'karaoke', 'instrumental') THEN
      'preserve_separately'
    WHEN t.detected_version_type IN ('remaster', 'mono', 'stereo', 'explicit', 'clean', 'radio_edit')
         AND gc.studio_count > 0 THEN
      'safe_alias_candidate'
    WHEN t.detected_version_type IN ('acoustic', 'extended_mix', 'featured') THEN
      'review_required'
    WHEN gc.variant_count > 1 AND t.detected_version_type = 'studio' THEN
      'preserve_separately'
    ELSE
      'preserve_separately'
  END AS preservation_recommendation
FROM typed t
JOIN group_context gc ON gc.canonical_candidate_key = t.canonical_candidate_key
ORDER BY t.canonical_candidate_key, t.detected_version_type, t.track_id;
