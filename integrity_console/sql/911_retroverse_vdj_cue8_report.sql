-- 911_retroverse_vdj_cue8_report.sql
-- Cue 8 thumbnail readiness (run after ingest).

SELECT
  (SELECT count(*)::int FROM retroverse_track_instances) AS track_instances,
  (SELECT count(*)::int FROM retroverse_track_instances WHERE retroverse_track_id IS NOT NULL) AS instances_linked_rvtr,
  (SELECT count(*)::int FROM retroverse_track_cues) AS total_cues,
  (SELECT count(*)::int FROM retroverse_track_cues WHERE is_thumbnail) AS thumbnail_cues,
  (SELECT count(*)::int FROM retroverse_track_cues WHERE is_thumbnail AND cue_number = 8) AS cue8_thumbnails,
  (SELECT count(*)::int FROM retroverse_track_cues WHERE is_thumbnail AND cue_number <> 8) AS name_only_thumbnails;

SELECT
  i.retroverse_track_id,
  i.file_path,
  c.cue_number,
  c.time_position_seconds,
  c.is_thumbnail
FROM retroverse_track_cues c
JOIN retroverse_track_instances i ON i.track_instance_id = c.track_instance_id
WHERE c.is_thumbnail AND c.cue_number = 8
ORDER BY i.retroverse_track_id NULLS LAST
LIMIT 25;
