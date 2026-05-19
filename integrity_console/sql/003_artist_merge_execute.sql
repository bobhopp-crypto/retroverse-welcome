-- 003_artist_merge_execute.sql
-- Merge one duplicate artist into one canonical artist.
-- WRITES DATA. Always run 002 dry-run first.
--
-- psql example:
--   \set duplicate_artist_id 42
--   \set canonical_artist_id 7
--   \i integrity_console/sql/003_artist_merge_execute.sql

BEGIN;

DO $$
DECLARE
  v_dup_id bigint := :duplicate_artist_id::bigint;
  v_can_id bigint := :canonical_artist_id::bigint;
  v_dup_name text;
  v_can_name text;
  v_tracks_updated int := 0;
  v_albums_updated int := 0;
  v_aliases_moved int := 0;
  v_aliases_deleted int := 0;
  v_alias_added int := 0;
BEGIN
  IF v_dup_id = v_can_id THEN
    RAISE EXCEPTION 'Cannot merge artist % into itself', v_dup_id;
  END IF;

  SELECT canonical_name
  INTO v_dup_name
  FROM artists
  WHERE id = v_dup_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Duplicate artist id % not found', v_dup_id;
  END IF;

  SELECT canonical_name
  INTO v_can_name
  FROM artists
  WHERE id = v_can_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical artist id % not found', v_can_id;
  END IF;

  -- Preserve duplicate display name as alias when it differs from canonical row name
  IF v_dup_name <> v_can_name
     AND NOT EXISTS (
       SELECT 1
       FROM artist_aliases aa
       WHERE aa.artist_id = v_can_id
         AND lower(trim(aa.alias_name)) = lower(trim(v_dup_name))
     ) THEN
    INSERT INTO artist_aliases (artist_id, alias_name, is_preferred)
    VALUES (v_can_id, v_dup_name, false);
    GET DIAGNOSTICS v_alias_added = ROW_COUNT;
  END IF;

  UPDATE tracks
  SET artist_id = v_can_id
  WHERE artist_id = v_dup_id;
  GET DIAGNOSTICS v_tracks_updated = ROW_COUNT;

  UPDATE albums
  SET artist_id = v_can_id
  WHERE artist_id = v_dup_id;
  GET DIAGNOSTICS v_albums_updated = ROW_COUNT;

  -- Remove alias rows on duplicate that would conflict after reassignment
  DELETE FROM artist_aliases dup_aa
  WHERE dup_aa.artist_id = v_dup_id
    AND EXISTS (
      SELECT 1
      FROM artist_aliases can_aa
      WHERE can_aa.artist_id = v_can_id
        AND lower(trim(can_aa.alias_name)) = lower(trim(dup_aa.alias_name))
    );
  GET DIAGNOSTICS v_aliases_deleted = ROW_COUNT;

  UPDATE artist_aliases
  SET artist_id = v_can_id
  WHERE artist_id = v_dup_id;
  GET DIAGNOSTICS v_aliases_moved = ROW_COUNT;

  DELETE FROM artists
  WHERE id = v_dup_id;

  RAISE NOTICE 'merge complete: dup=% (%), canonical=% (%)',
    v_dup_id, v_dup_name, v_can_id, v_can_name;
  RAISE NOTICE 'tracks updated: %', v_tracks_updated;
  RAISE NOTICE 'albums updated: %', v_albums_updated;
  RAISE NOTICE 'aliases moved: %', v_aliases_moved;
  RAISE NOTICE 'aliases deleted (conflict): %', v_aliases_deleted;
  RAISE NOTICE 'duplicate name preserved as alias: %', v_alias_added;
END;
$$;

COMMIT;

-- Verify (optional, read after commit)
-- SELECT id, canonical_name FROM artists WHERE id = :canonical_artist_id::bigint;
