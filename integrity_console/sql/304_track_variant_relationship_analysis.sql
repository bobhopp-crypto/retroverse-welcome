-- 304_track_variant_relationship_analysis.sql
-- Pairwise variant relationships inside proposed families. Read-only.

WITH normalized AS (
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
    ) AS normalized_title_aggressive,
    (t.title ~* 'medley') AS is_medley,
    (t.title ~* 'remaster|re-master') AS has_remaster,
    (t.title ~* '\mlive\M') AS has_live,
    (t.title ~* 'remix') AS has_remix
  FROM tracks t
  WHERE t.artist_id IS NOT NULL
),
family_keys AS (
  SELECT
    n.*,
    CASE
      WHEN n.is_medley THEN
        n.artist_id::text || '::medley::' || n.normalized_title_basic
      ELSE
        n.artist_id::text || '::' || coalesce(nullif(n.normalized_title_aggressive, ''), n.normalized_title_basic)
    END AS proposed_family_key
  FROM normalized n
),
family_groups AS (
  SELECT proposed_family_key
  FROM family_keys
  GROUP BY proposed_family_key
  HAVING count(*) > 1
),
members AS (
  SELECT fk.*
  FROM family_keys fk
  JOIN family_groups fg ON fg.proposed_family_key = fk.proposed_family_key
),
pairs AS (
  SELECT
    a.track_id AS track_a_id,
    a.original_title AS track_a,
    b.track_id AS track_b_id,
    b.original_title AS track_b,
    a.proposed_family_key,
    a.normalized_title_basic AS basic_a,
    b.normalized_title_basic AS basic_b,
    a.has_remaster AS remaster_a,
    b.has_remaster AS remaster_b,
    a.has_live AS live_a,
    b.has_live AS live_b,
    a.has_remix AS remix_a,
    b.has_remix AS remix_b
  FROM members a
  JOIN members b
    ON b.proposed_family_key = a.proposed_family_key
   AND b.track_id > a.track_id
)
SELECT
  track_a_id AS track_a,
  track_a AS track_a_title,
  track_b_id AS track_b,
  track_b AS track_b_title,
  CASE
    WHEN basic_a = basic_b AND NOT live_a AND NOT live_b AND NOT remix_a AND NOT remix_b THEN
      'probable_exact_duplicate'
    WHEN (remaster_a OR remaster_b) AND basic_a = basic_b THEN
      'probable_remaster_chain'
    WHEN (live_a OR live_b) THEN
      'probable_live_variant'
    WHEN basic_a = basic_b THEN
      'probable_release_duplicate'
    ELSE
      'related_variant'
  END AS relationship_type,
  CASE
    WHEN basic_a = basic_b AND NOT live_a AND NOT live_b AND NOT remix_a AND NOT remix_b THEN 90
    WHEN (remaster_a OR remaster_b) AND basic_a = basic_b THEN 75
    WHEN (live_a OR live_b) THEN 55
    WHEN basic_a = basic_b THEN 70
    ELSE 50
  END AS confidence_score,
  CASE
    WHEN basic_a = basic_b AND NOT live_a AND NOT live_b AND NOT remix_a AND NOT remix_b THEN
      'safe_future_merge'
    WHEN live_a OR live_b OR remix_a OR remix_b THEN
      'preserve_separate'
    WHEN remaster_a OR remaster_b THEN
      'review_required'
    ELSE
      'review_required'
  END AS merge_safety,
  CASE
    WHEN basic_a = basic_b AND NOT live_a AND NOT live_b THEN
      'chart lineage must remain attached to original track rows until explicit merge'
    WHEN live_a OR live_b THEN
      'live performances are distinct chart/release identities — preserve separately'
    WHEN remaster_a OR remaster_b THEN
      'remaster chain — preserve chart week provenance per track row'
    ELSE
      'review variant relationship before any merge'
  END AS lineage_preservation_note
FROM pairs
ORDER BY confidence_score DESC, proposed_family_key, track_a_id, track_b_id
LIMIT 10000;
