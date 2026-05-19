-- 005_artist_lowercase_bulk_merge_execute.sql
-- Execute safe case/spacing-only bulk merges.
-- WRITES DATA. Run 004 dry-run first and review the result set.
--
-- To abort before changes: comment out COMMIT and use ROLLBACK at end.

BEGIN;

DO $$
DECLARE
  rec record;
  v_tracks int;
  v_albums int;
  v_aliases_moved int;
  v_aliases_deleted int;
  v_total_merges int := 0;
  v_total_tracks int := 0;
  v_total_albums int := 0;
BEGIN
  FOR rec IN
    WITH artist_stats AS (
      SELECT
        a.id AS artist_id,
        a.canonical_name AS artist_name,
        lower(trim(regexp_replace(a.canonical_name, '\s+', ' ', 'g'))) AS normalized_name,
        (a.canonical_name <> lower(a.canonical_name)) AS has_mixed_case,
        coalesce(t.track_count, 0) AS track_count,
        coalesce(al.album_count, 0) AS album_count,
        coalesce(ch.chart_row_count, 0) AS chart_row_count
      FROM artists a
      LEFT JOIN (
        SELECT artist_id, count(*)::int AS track_count FROM tracks GROUP BY artist_id
      ) t ON t.artist_id = a.id
      LEFT JOIN (
        SELECT artist_id, count(*)::int AS album_count FROM albums GROUP BY artist_id
      ) al ON al.artist_id = a.id
      LEFT JOIN (
        SELECT tr.artist_id, count(*)::int AS chart_row_count
        FROM chart_appearances ca
        JOIN tracks tr ON tr.id = ca.track_id
        WHERE tr.artist_id IS NOT NULL
        GROUP BY tr.artist_id
      ) ch ON ch.artist_id = a.id
    ),
    duplicate_groups AS (
      SELECT normalized_name
      FROM artist_stats
      GROUP BY normalized_name
      HAVING count(*) > 1
    ),
    group_safety AS (
      SELECT s.normalized_name
      FROM artist_stats s
      JOIN duplicate_groups d ON d.normalized_name = s.normalized_name
      GROUP BY s.normalized_name
      HAVING
        count(*) = count(*) FILTER (
          WHERE lower(trim(regexp_replace(s.artist_name, '\s+', ' ', 'g'))) = s.normalized_name
        )
        AND count(*) FILTER (WHERE s.has_mixed_case) <= 1
    ),
    ranked AS (
      SELECT
        s.artist_id,
        s.artist_name,
        s.normalized_name,
        s.has_mixed_case,
        s.chart_row_count,
        s.track_count,
        s.album_count,
        row_number() OVER (
          PARTITION BY s.normalized_name
          ORDER BY
            s.has_mixed_case DESC,
            s.chart_row_count DESC,
            s.track_count DESC,
            s.album_count DESC,
            s.artist_id ASC
        ) AS canonical_rank
      FROM artist_stats s
      JOIN group_safety gs ON gs.normalized_name = s.normalized_name
    ),
    canonical_pick AS (
      SELECT normalized_name, artist_id AS canonical_artist_id
      FROM ranked
      WHERE canonical_rank = 1
    )
    SELECT
      d.artist_id AS duplicate_artist_id,
      d.artist_name AS duplicate_artist_name,
      c.canonical_artist_id
    FROM ranked d
    JOIN canonical_pick c ON c.normalized_name = d.normalized_name
    WHERE d.canonical_rank > 1
    ORDER BY d.normalized_name, d.artist_id
  LOOP
    -- lock both artist rows
    PERFORM 1 FROM artists WHERE id = rec.duplicate_artist_id FOR UPDATE;
    PERFORM 1 FROM artists WHERE id = rec.canonical_artist_id FOR UPDATE;

    IF rec.duplicate_artist_id = rec.canonical_artist_id THEN
      CONTINUE;
    END IF;

    IF rec.duplicate_artist_name <> (
      SELECT canonical_name FROM artists WHERE id = rec.canonical_artist_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM artist_aliases aa
      WHERE aa.artist_id = rec.canonical_artist_id
        AND lower(trim(aa.alias_name)) = lower(trim(rec.duplicate_artist_name))
    ) THEN
      INSERT INTO artist_aliases (artist_id, alias_name, is_preferred)
      VALUES (rec.canonical_artist_id, rec.duplicate_artist_name, false);
    END IF;

    UPDATE tracks SET artist_id = rec.canonical_artist_id
    WHERE artist_id = rec.duplicate_artist_id;
    GET DIAGNOSTICS v_tracks = ROW_COUNT;
    v_total_tracks := v_total_tracks + v_tracks;

    UPDATE albums SET artist_id = rec.canonical_artist_id
    WHERE artist_id = rec.duplicate_artist_id;
    GET DIAGNOSTICS v_albums = ROW_COUNT;
    v_total_albums := v_total_albums + v_albums;

    DELETE FROM artist_aliases dup_aa
    WHERE dup_aa.artist_id = rec.duplicate_artist_id
      AND EXISTS (
        SELECT 1 FROM artist_aliases can_aa
        WHERE can_aa.artist_id = rec.canonical_artist_id
          AND lower(trim(can_aa.alias_name)) = lower(trim(dup_aa.alias_name))
      );
    GET DIAGNOSTICS v_aliases_deleted = ROW_COUNT;

    UPDATE artist_aliases SET artist_id = rec.canonical_artist_id
    WHERE artist_id = rec.duplicate_artist_id;
    GET DIAGNOSTICS v_aliases_moved = ROW_COUNT;

    DELETE FROM artists WHERE id = rec.duplicate_artist_id;

    v_total_merges := v_total_merges + 1;

    RAISE NOTICE 'merged artist % (%) -> % | tracks=% albums=% aliases_moved=% aliases_dropped=%',
      rec.duplicate_artist_id,
      rec.duplicate_artist_name,
      rec.canonical_artist_id,
      v_tracks,
      v_albums,
      v_aliases_moved,
      v_aliases_deleted;
  END LOOP;

  RAISE NOTICE 'bulk merge summary: merges=% tracks_reassigned=% albums_reassigned=%',
    v_total_merges, v_total_tracks, v_total_albums;
END;
$$;

COMMIT;
