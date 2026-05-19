-- 503_musicbrainz_tracklist_linkage.sql
-- MusicBrainz tracklist ↔ album / edition / track_family linkage analysis. Read-only.

WITH staging AS (
  SELECT
    st.*,
    lower(trim(regexp_replace(st.source_artist, '\s+', ' ', 'g'))) AS norm_artist,
    lower(trim(regexp_replace(st.source_album, '\s+', ' ', 'g'))) AS norm_album,
    lower(trim(regexp_replace(st.track_title, '\s+', ' ', 'g'))) AS norm_track
  FROM staging_album_tracklist_imports st
),
resolved AS (
  SELECT
    s.*,
    a.id AS artist_id,
    al.id AS album_id,
    al.title AS canonical_album_title,
    ae.id AS album_edition_id,
    t.id AS track_id,
    tfm.track_family_id,
    tf.canonical_name AS track_family_name,
    tfm.relationship_type,
    tfm.is_primary_recording
  FROM staging s
  LEFT JOIN artists a ON lower(trim(a.canonical_name)) = s.norm_artist
  LEFT JOIN albums al
    ON al.artist_id = a.id
   AND lower(trim(al.title)) = s.norm_album
  LEFT JOIN album_editions ae
    ON ae.album_id = al.id
   AND lower(trim(ae.edition_name)) = lower(trim(coalesce(s.edition_name, al.title)))
  LEFT JOIN tracks t
    ON t.album_id = al.id
   AND lower(trim(t.title)) = s.norm_track
  LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
  LEFT JOIN track_families tf ON tf.id = tfm.track_family_id
)
SELECT
  r.source_name,
  r.source_artist,
  r.source_album,
  coalesce(r.edition_name, '—') AS edition,
  r.disc_number,
  r.track_number,
  r.track_title,
  r.mb_release_mbid,
  r.mb_recording_mbid,
  r.canonical_album_title AS resolved_album,
  r.track_family_id,
  r.track_family_name,
  r.track_id AS matched_track_id,
  least(100, greatest(0,
    (CASE WHEN r.album_id IS NOT NULL THEN 30 ELSE 0 END)
    + (CASE WHEN r.track_family_id IS NOT NULL THEN 25 ELSE 0 END)
    + (CASE WHEN r.track_id IS NOT NULL THEN 35 ELSE 0 END)
    + (CASE WHEN r.mb_recording_mbid IS NOT NULL THEN 10 ELSE 0 END)
  ))::int AS linkage_confidence,
  CASE
    WHEN r.album_id IS NULL THEN 'unmatched_album'
    WHEN r.track_id IS NULL THEN 'unmatched_track'
    WHEN r.track_family_id IS NULL THEN 'unmatched_track_family'
    ELSE 'linked'
  END AS mapping_status,
  concat_ws(
    '; ',
    CASE WHEN r.album_id IS NULL THEN 'no canonical album match' END,
    CASE WHEN r.track_id IS NULL THEN 'no track row on album' END,
    CASE WHEN r.track_family_id IS NULL AND r.track_id IS NOT NULL THEN 'track not in track_family_members' END,
    CASE WHEN r.edition_name IS NOT NULL THEN 'edition: ' || r.edition_name END,
    CASE WHEN r.is_primary_recording = false THEN 'non-primary family member' END
  ) AS notes
FROM resolved r
ORDER BY mapping_status, linkage_confidence DESC, r.source_artist, r.source_album, r.disc_number, r.track_number
LIMIT 5000;
