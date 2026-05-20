-- 807_acoustic_linkage_readiness_report.sql
-- Phase 8A acoustic materialization readiness. Read-only.

WITH staging_stats AS (
  SELECT count(*)::int AS staging_rows FROM staging_acoustic_tracks
),
candidate_stats AS (
  SELECT
    count(*)::int AS candidates,
    count(*) FILTER (WHERE review_flag = 'ok')::int AS ok_rows,
    count(*) FILTER (WHERE review_flag = 'review_required')::int AS review_rows,
    count(*) FILTER (WHERE confidence_score >= 85)::int AS high_confidence
  FROM acoustic_track_album_candidates
),
lineage_stats AS (
  SELECT count(*)::int AS acoustics_lineage
  FROM album_track_lineage
  WHERE source_provenance = 'acoustics'
),
ctal_stats AS (
  SELECT count(*)::int AS acoustics_ctal
  FROM canonical_track_album_links
  WHERE source = 'acoustics'
),
hot100_stats AS (
  SELECT
    count(*)::int AS hot100_total,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM chart_track_album_links l WHERE l.chart_appearance_id = ca.id
    ))::int AS hot100_linked,
    count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM chart_track_album_links l WHERE l.chart_appearance_id = ca.id
    ))::int AS hot100_unresolved
  FROM chart_appearances ca
  WHERE ca.chart_name = 'Billboard Hot 100' AND ca.track_id IS NOT NULL
),
dup_triples AS (
  SELECT count(*)::int AS duplicate_triple_rows
  FROM (
    SELECT source_artist, source_album, source_song, count(*) AS c
    FROM staging_acoustic_tracks
    GROUP BY source_artist, source_album, source_song
    HAVING count(*) > 1
  ) d
)
SELECT 'SUMMARY' AS section, metric, value::text AS detail
FROM (
  SELECT 'staging_acoustic_tracks' AS metric, staging_rows AS value FROM staging_stats
  UNION ALL SELECT 'candidates', candidates FROM candidate_stats
  UNION ALL SELECT 'candidates_ok', ok_rows FROM candidate_stats
  UNION ALL SELECT 'candidates_review_required', review_rows FROM candidate_stats
  UNION ALL SELECT 'candidates_high_confidence', high_confidence FROM candidate_stats
  UNION ALL SELECT 'album_track_lineage_acoustics', acoustics_lineage FROM lineage_stats
  UNION ALL SELECT 'canonical_track_album_links_acoustics', acoustics_ctal FROM ctal_stats
  UNION ALL SELECT 'hot100_chart_rows', hot100_total FROM hot100_stats
  UNION ALL SELECT 'hot100_linked', hot100_linked FROM hot100_stats
  UNION ALL SELECT 'hot100_unresolved', hot100_unresolved FROM hot100_stats
  UNION ALL SELECT 'duplicate_artist_album_song_triples', duplicate_triple_rows FROM dup_triples
) s

UNION ALL

SELECT section, metric, detail
FROM (
  SELECT
    'TOP_AMBIGUOUS_SONG' AS section,
    source_artist || ' — ' || source_song AS metric,
    count(DISTINCT source_album)::text AS detail,
    count(DISTINCT source_album) AS sort_n
  FROM staging_acoustic_tracks
  GROUP BY source_artist, source_song
  HAVING count(DISTINCT source_album) > 1
  ORDER BY sort_n DESC
  LIMIT 25
) amb;
