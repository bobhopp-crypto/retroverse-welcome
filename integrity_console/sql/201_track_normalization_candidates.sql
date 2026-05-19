-- 201_track_normalization_candidates.sql
-- Per-track normalization analysis. Read-only. No mutations.

WITH base AS (
  SELECT
    t.id AS track_id,
    t.artist_id,
    a.canonical_name AS artist_name,
    t.title AS original_title,
    t.duration_seconds,
    length(t.title) AS title_length
  FROM tracks t
  LEFT JOIN artists a ON a.id = t.artist_id
),
step_basic AS (
  SELECT
    b.*,
    lower(trim(regexp_replace(b.original_title, '\s+', ' ', 'g'))) AS normalized_title_basic
  FROM base b
),
step_punct AS (
  SELECT
    s.*,
    lower(
      trim(
        regexp_replace(
          regexp_replace(
            regexp_replace(s.normalized_title_basic, '[''[\](){}]', ' ', 'g'),
            '[–—−]',
            '-',
            'g'
          ),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS s2
  FROM step_basic s
),
step_feat AS (
  SELECT
    p.*,
    lower(
      trim(
        regexp_replace(
          regexp_replace(p.s2, '\m(feat\.?|featuring|ft\.?)\M', ' feat ', 'gi'),
          '\s+',
          ' ',
          'g'
        )
      )
    ) AS s3
  FROM step_punct p
),
step_suffix AS (
  SELECT
    f.*,
    regexp_replace(
      f.s3,
      '\s*[-]\s*(remastered?|live|radio edit|mono|stereo|explicit|clean|instrumental|karaoke|acoustic|extended mix|remix).*$',
      '',
      'gi'
    ) AS s4a,
    regexp_replace(
      f.s3,
      '\s*[([]\s*(.*?(remaster|live|remix|radio edit|mono|stereo|explicit|clean|instrumental|karaoke|acoustic|extended mix).*?)\s*[])]\s*$',
      '',
      'gi'
    ) AS s4b
  FROM step_feat f
),
step_aggressive AS (
  SELECT
    s.*,
    lower(trim(regexp_replace(coalesce(nullif(s.s4a, ''), s.s3), '\s+', ' ', 'g'))) AS after_dash_strip,
    CASE
      WHEN s.s4a <> s.s3 AND s.s4a <> '' THEN
        trim(regexp_replace(s.s3, '.*' || regexp_replace(s.s4a, '([.^$|*+?(){}\[\]\\])', '\\\1', 'g') || '$', '', 'i'))
      ELSE NULL
    END AS dash_stripped_part
  FROM step_suffix s
),
final_norm AS (
  SELECT
    a.*,
    lower(
      trim(
        regexp_replace(
          regexp_replace(coalesce(nullif(a.after_dash_strip, ''), a.s3), '\s+', ' ', 'g'),
          '^\s+|\s+$',
          '',
          'g'
        )
      )
    ) AS normalized_title_aggressive,
    coalesce(
      a.dash_stripped_part,
      CASE
        WHEN a.s4b <> a.s3 AND a.s4b <> '' THEN
          trim(both ' ' from regexp_replace(a.s3, regexp_replace(a.s4b, '([.^$|*+?(){}\[\]\\])', '\\\1', 'g'), ''))
        ELSE NULL
      END
    ) AS stripped_suffix
  FROM step_aggressive a
),
flags AS (
  SELECT
    n.*,
    (n.original_title ~* '\m(feat\.?|featuring|ft\.?)\M') AS has_feature,
    (n.original_title ~* 'remaster|re-master') AS has_remaster,
    (n.original_title ~* '\mlive\M') AS has_live,
    (n.original_title ~* 'remix') AS has_remix,
    (n.original_title ~* 'radio\s*edit') AS has_radio_edit,
    (n.original_title ~* '\mmono\M') AS has_mono,
    (n.original_title ~* '\mstereo\M') AS has_stereo,
    (n.original_title ~* 'explicit') AS has_explicit,
    (n.original_title ~* '\mclean\M') AS has_clean,
    (n.original_title ~* 'instrumental') AS has_instrumental,
    (n.original_title ~* 'karaoke') AS has_karaoke,
    (n.original_title ~* 'acoustic') AS has_acoustic,
    (n.original_title ~* 'extended\s*mix') AS has_extended_mix,
    (n.original_title ~* 'medley') AS has_medley,
    nullif(
      concat_ws(
        ',',
        CASE WHEN n.original_title ~* 'remaster|re-master' THEN 'remaster' END,
        CASE WHEN n.original_title ~* '\mlive\M' THEN 'live' END,
        CASE WHEN n.original_title ~* 'remix' THEN 'remix' END,
        CASE WHEN n.original_title ~* 'radio\s*edit' THEN 'radio_edit' END,
        CASE WHEN n.original_title ~* '\mmono\M' THEN 'mono' END,
        CASE WHEN n.original_title ~* '\mstereo\M' THEN 'stereo' END,
        CASE WHEN n.original_title ~* 'explicit' THEN 'explicit' END,
        CASE WHEN n.original_title ~* '\mclean\M' THEN 'clean' END,
        CASE WHEN n.original_title ~* 'instrumental' THEN 'instrumental' END,
        CASE WHEN n.original_title ~* 'karaoke' THEN 'karaoke' END,
        CASE WHEN n.original_title ~* 'acoustic' THEN 'acoustic' END,
        CASE WHEN n.original_title ~* 'extended\s*mix' THEN 'extended_mix' END,
        CASE WHEN n.original_title ~* '\m(feat\.?|featuring|ft\.?)\M' THEN 'featured_artist' END
      ),
      ''
    ) AS version_flags
  FROM final_norm n
)
SELECT
  track_id,
  artist_id,
  artist_name,
  original_title,
  normalized_title_basic,
  normalized_title_aggressive,
  CASE
    WHEN has_medley THEN 'medley'
    WHEN has_remix THEN 'remix'
    WHEN has_live THEN 'live'
    WHEN has_remaster THEN 'remaster'
    WHEN has_radio_edit THEN 'radio_edit'
    WHEN has_acoustic THEN 'acoustic'
    WHEN has_instrumental THEN 'instrumental'
    WHEN has_karaoke THEN 'karaoke'
    WHEN has_mono THEN 'mono'
    WHEN has_stereo THEN 'stereo'
    WHEN has_explicit THEN 'explicit'
    WHEN has_clean THEN 'clean'
    WHEN has_extended_mix THEN 'extended_mix'
    WHEN has_feature THEN 'featured'
    ELSE 'studio'
  END AS likely_version_type,
  has_feature,
  has_remaster,
  has_live,
  has_remix,
  version_flags,
  CASE
    WHEN has_feature THEN 'featured_artist_present'
    ELSE NULL
  END AS featured_artist_flags,
  stripped_suffix,
  title_length
FROM flags
ORDER BY artist_id, normalized_title_aggressive, track_id;
