-- 405_album_graph_preview.sql
-- Read-only album identity graph inspection.

SELECT
  a.canonical_name AS artist,
  al.id AS album_id,
  al.title AS album,
  al.release_year AS album_release_year,
  coalesce(ae.edition_name, '—') AS edition,
  ae.is_canonical AS edition_is_canonical,
  tf.id AS track_family_id,
  tf.canonical_name AS track_family_name,
  t.id AS track_id,
  t.title AS track_title,
  tfm.relationship_type AS track_relationship,
  tfm.is_primary_recording,
  coalesce(ca_album.cnt, 0) + coalesce(ca_track.cnt, 0) AS chart_rows
FROM albums al
JOIN artists a ON a.id = al.artist_id
LEFT JOIN album_editions ae ON ae.album_id = al.id
LEFT JOIN tracks t ON t.album_id = al.id
LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
LEFT JOIN track_families tf ON tf.id = tfm.track_family_id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS cnt FROM chart_appearances ca WHERE ca.album_id = al.id
) ca_album ON true
LEFT JOIN LATERAL (
  SELECT count(*)::int AS cnt FROM chart_appearances ca WHERE ca.track_id = t.id
) ca_track ON true
ORDER BY a.canonical_name, al.title, ae.is_canonical DESC NULLS LAST, ae.edition_name, tf.canonical_name, t.id
LIMIT 2000;
