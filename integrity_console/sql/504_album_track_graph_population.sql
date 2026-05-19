-- 504_album_track_graph_population.sql
-- Populate album_track_lineage from staging + existing tracks/families. Additive, idempotent.
-- Prerequisite: 501, staging_album_tracklist_imports (optional), existing albums/tracks

BEGIN;

-- From MusicBrainz / dossier staging rows with resolved album
WITH staging AS (
  SELECT
    st.*,
    a.id AS artist_id,
    al.id AS album_id,
    ae.id AS album_edition_id
  FROM staging_album_tracklist_imports st
  LEFT JOIN artists a ON lower(trim(a.canonical_name)) = lower(trim(st.source_artist))
  LEFT JOIN albums al
    ON al.artist_id = a.id
   AND lower(trim(al.title)) = lower(trim(st.source_album))
  LEFT JOIN album_editions ae
    ON ae.album_id = al.id
   AND lower(trim(ae.edition_name)) = lower(trim(coalesce(st.edition_name, al.title)))
),
family_track AS (
  SELECT
    s.*,
    tf.id AS track_family_id,
    t.id AS track_id,
    row_number() OVER (
      PARTITION BY s.album_id, coalesce(s.album_edition_id, 0)
      ORDER BY s.disc_number NULLS LAST, s.track_number NULLS LAST, s.id
    ) AS sequence_index
  FROM staging s
  LEFT JOIN track_families tf
    ON tf.canonical_artist_id = s.artist_id
  LEFT JOIN track_family_members tfm ON tfm.track_family_id = tf.id
  LEFT JOIN tracks t
    ON t.id = tfm.track_id
   AND lower(trim(t.title)) = lower(trim(s.track_title))
  WHERE s.album_id IS NOT NULL
)
INSERT INTO album_track_lineage (
  album_id,
  album_edition_id,
  track_family_id,
  track_id,
  disc_number,
  track_number,
  sequence_index,
  source_provenance,
  source_row_hash
)
SELECT
  ft.album_id,
  ft.album_edition_id,
  ft.track_family_id,
  ft.track_id,
  coalesce(ft.disc_number, 1),
  ft.track_number,
  ft.sequence_index,
  ft.source_name,
  ft.content_hash
FROM family_track ft
ON CONFLICT (source_provenance, source_row_hash) DO NOTHING;

-- From existing album tracks not yet in lineage (canonical graph bootstrap)
INSERT INTO album_track_lineage (
  album_id,
  album_edition_id,
  track_family_id,
  track_id,
  disc_number,
  track_number,
  sequence_index,
  source_provenance,
  source_row_hash
)
SELECT
  t.album_id,
  (SELECT ae.id FROM album_editions ae WHERE ae.album_id = t.album_id AND ae.is_canonical LIMIT 1),
  tfm.track_family_id,
  t.id,
  1,
  t.track_number,
  row_number() OVER (PARTITION BY t.album_id ORDER BY t.track_number NULLS LAST, t.id),
  'canonical_tracks_bootstrap',
  'track:' || t.id::text
FROM tracks t
LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
WHERE t.album_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM album_track_lineage atl
    WHERE atl.album_id = t.album_id AND atl.track_id = t.id
      AND atl.source_provenance = 'canonical_tracks_bootstrap'
  )
ON CONFLICT (source_provenance, source_row_hash) DO NOTHING;

COMMIT;

SELECT source_provenance, count(*) AS rows
FROM album_track_lineage
GROUP BY source_provenance
ORDER BY rows DESC;
