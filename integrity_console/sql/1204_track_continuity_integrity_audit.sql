-- 1204_track_continuity_integrity_audit.sql
-- Read-only diagnostics for canonical track ↔ album continuity.

\echo '=== Track continuity integrity ==='

WITH track_albums AS (
  SELECT
    ct.track_id,
    ct.canonical_title,
    ct.canonical_artist_name,
    ct.has_hot100,
    ct.has_vdj_media,
    count(DISTINCT cat.album_id)::int AS album_track_rows,
    count(DISTINCT ctal.album_id)::int AS album_link_rows
  FROM canonical_tracks ct
  LEFT JOIN canonical_album_tracks cat ON cat.canonical_track_key = ct.track_id
  LEFT JOIN canonical_track_album_links ctal ON ctal.track_family_id = ct.track_family_id
  GROUP BY ct.track_id, ct.canonical_title, ct.canonical_artist_name, ct.has_hot100, ct.has_vdj_media
),
orphan_tracks AS (
  SELECT count(*)::int AS tracks_without_album
  FROM track_albums
  WHERE album_track_rows = 0 AND album_link_rows = 0
),
hot100_orphans AS (
  SELECT count(*)::int AS hot100_without_album
  FROM track_albums
  WHERE has_hot100 AND album_track_rows = 0 AND album_link_rows = 0
),
multi_album AS (
  SELECT
    track_id,
    canonical_title,
    canonical_artist_name,
    album_track_rows + album_link_rows AS link_count
  FROM track_albums
  WHERE (album_track_rows + album_link_rows) > 3
  ORDER BY link_count DESC, canonical_artist_name, canonical_title
  LIMIT 25
),
dup_entities AS (
  SELECT
    canonical_artist_name,
    normalized_title_key,
    count(*)::int AS entity_count,
    string_agg(track_id, ', ' ORDER BY track_id) AS track_ids
  FROM canonical_tracks
  GROUP BY canonical_artist_name, normalized_title_key
  HAVING count(*) > 1
),
compilation_only AS (
  SELECT
    ta.track_id,
    ta.canonical_title,
    ta.canonical_artist_name,
    string_agg(DISTINCT al.title, ' | ' ORDER BY al.title) AS album_titles
  FROM track_albums ta
  JOIN canonical_album_tracks cat ON cat.canonical_track_key = ta.track_id
  JOIN albums al ON al.id = cat.album_id
  WHERE ta.album_track_rows > 0
  GROUP BY ta.track_id, ta.canonical_title, ta.canonical_artist_name
  HAVING bool_and(
    al.title ~* 'greatest hits|best of|anthology|compilation|now that''s what|the very best|gold:|platinum collection'
  )
  LIMIT 25
)
SELECT 'tracks_without_any_album_link' AS metric, tracks_without_album AS value FROM orphan_tracks
UNION ALL
SELECT 'hot100_tracks_without_album_link', hot100_without_album FROM hot100_orphans;

\echo '--- multi-album tracks (top 25) ---'
SELECT * FROM multi_album;

\echo '--- duplicate canonical entities ---'
SELECT * FROM dup_entities ORDER BY entity_count DESC LIMIT 25;

\echo '--- compilation-only album attachments (sample) ---'
SELECT * FROM compilation_only;

\echo '--- Rhinestone Cowboy (Glen Campbell) ---'
SELECT
  ct.track_id,
  ct.canonical_title,
  ct.canonical_artist_name,
  al.title AS album_title,
  al.release_year,
  cat.position,
  cat.canonical_track_key IS NOT NULL AS rvtr_on_row
FROM canonical_tracks ct
LEFT JOIN canonical_album_tracks cat ON cat.canonical_track_key = ct.track_id
LEFT JOIN albums al ON al.id = cat.album_id
WHERE lower(ct.canonical_title) LIKE '%rhinestone%cowboy%'
   OR lower(al.title) LIKE '%rhinestone%cowboy%'
ORDER BY ct.track_id, al.release_year NULLS LAST, cat.position NULLS LAST;
