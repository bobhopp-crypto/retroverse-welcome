-- 1203_populate_canonical_track_graph.sql
-- Load canonical_tracks + versions from staging CSV.
--
--   python3 scripts/export_canonical_track_graph_staging.py
--   psql ... -c "\copy staging_canonical_track_imports FROM 'exports/graph/canonical_tracks_staging.csv' CSV HEADER"
--   psql ... -c "\copy staging_canonical_track_version_imports FROM 'exports/graph/canonical_track_versions_staging.csv' CSV HEADER"
--
-- Idempotent: replaces graph rows for track_ids present in staging.

BEGIN;

DELETE FROM canonical_track_versions v
USING canonical_tracks ct, staging_canonical_track_imports st
WHERE v.canonical_track_id = ct.id
  AND ct.track_id = upper(trim(st.track_id));

DELETE FROM canonical_tracks ct
USING staging_canonical_track_imports st
WHERE ct.track_id = upper(trim(st.track_id));

INSERT INTO canonical_tracks (
  track_id,
  canonical_title,
  normalized_title_key,
  artist_id,
  canonical_artist_name,
  first_chart_date,
  peak_hot100_position,
  chart_weeks,
  has_hot100,
  has_vdj_media,
  has_video,
  has_audio,
  has_youtube,
  graph_track_id,
  track_family_id,
  retroverse_track_id,
  identity_source,
  confidence_score,
  review_flag,
  updated_at
)
SELECT
  upper(trim(st.track_id)),
  trim(st.canonical_title),
  trim(st.normalized_title_key),
  NULLIF(trim(st.artist_id), '')::bigint,
  trim(st.canonical_artist_name),
  NULLIF(trim(st.first_chart_date), '')::date,
  NULLIF(trim(st.peak_hot100_position), '')::integer,
  coalesce(st.chart_weeks, 0),
  coalesce(st.has_hot100::text in ('t', 'true', '1', 'yes'), false),
  coalesce(st.has_vdj_media::text in ('t', 'true', '1', 'yes'), false),
  coalesce(st.has_video::text in ('t', 'true', '1', 'yes'), false),
  coalesce(st.has_audio::text in ('t', 'true', '1', 'yes'), false),
  coalesce(st.has_youtube::text in ('t', 'true', '1', 'yes'), false),
  NULLIF(trim(st.graph_track_id), '')::bigint,
  NULLIF(trim(st.track_family_id), '')::bigint,
  NULLIF(upper(trim(st.retroverse_track_id)), ''),
  trim(st.identity_source),
  coalesce(st.confidence_score, 0.9),
  coalesce(nullif(trim(st.review_flag), ''), 'ok'),
  now()
FROM staging_canonical_track_imports st;

INSERT INTO canonical_track_versions (
  canonical_track_id,
  source_type,
  source_track_key,
  source_title,
  source_artist,
  source_album,
  version_type,
  release_date,
  is_primary,
  confidence_score,
  graph_track_id,
  acoustic_source_id,
  media_asset_id
)
SELECT
  ct.id,
  trim(sv.source_type),
  nullif(trim(sv.source_track_key), ''),
  trim(sv.source_title),
  nullif(trim(sv.source_artist), ''),
  nullif(trim(sv.source_album), ''),
  coalesce(nullif(trim(sv.version_type), ''), 'variant'),
  nullif(trim(sv.release_date), '')::date,
  coalesce(sv.is_primary::text in ('t', 'true', '1', 'yes'), false),
  coalesce(sv.confidence_score, 0.5),
  NULLIF(trim(sv.graph_track_id), '')::bigint,
  NULLIF(trim(sv.acoustic_source_id), '')::bigint,
  NULLIF(trim(sv.media_asset_id), '')::bigint
FROM staging_canonical_track_version_imports sv
JOIN canonical_tracks ct ON ct.track_id = upper(trim(sv.track_id));

-- Backfill album canonical rows with RVTR keys (title + artist match)
UPDATE canonical_album_tracks cat
SET canonical_track_key = ct.track_id,
    updated_at = now()
FROM albums al,
     artists ar,
     canonical_tracks ct
WHERE cat.album_id = al.id
  AND ar.id = al.artist_id
  AND ct.artist_id = ar.id
  AND ct.normalized_title_key = lower(
    trim(
      regexp_replace(
        regexp_replace(
          regexp_replace(lower(trim(cat.title)), '[''[\](){}]', ' ', 'g'),
          '[–—−]', '-', 'g'
        ),
        '\s*[-]\s*(remastered?|live|radio edit|mono|stereo|explicit|clean|instrumental|karaoke|acoustic|extended mix|remix).*$',
        '',
        'gi'
      )
    )
  )
  AND (cat.canonical_track_key IS NULL OR cat.canonical_track_key <> ct.track_id);

COMMIT;
