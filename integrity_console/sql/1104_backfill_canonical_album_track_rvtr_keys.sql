-- 1104_backfill_canonical_album_track_rvtr_keys.sql
-- Re-link canonical_album_tracks rows to RVTR after new sequences are loaded.

BEGIN;

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

SELECT count(*)::int AS linked_rows
FROM canonical_album_tracks
WHERE canonical_track_key IS NOT NULL;
