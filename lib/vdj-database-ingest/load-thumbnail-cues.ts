import type { RetroverseSupabase } from "@/lib/retroverse-supabase";

export type ThumbnailCueRow = {
  cue_id: string;
  track_instance_id: string;
  retroverse_track_id: string | null;
  cue_number: number;
  cue_name: string | null;
  time_position_seconds: number | null;
  file_path: string;
};

/** Read canonical Cue 8 (and name-flagged) thumbnail cues for a track or instance. */
export async function loadThumbnailCuesForTrack(
  supabase: RetroverseSupabase,
  retroverseTrackId: string,
): Promise<ThumbnailCueRow[]> {
  const { data: instances, error: instErr } = await supabase
    .from("retroverse_track_instances")
    .select("track_instance_id, retroverse_track_id, file_path")
    .eq("retroverse_track_id", retroverseTrackId);
  if (instErr) throw instErr;
  if (!instances?.length) return [];

  const ids = instances.map((r) => r.track_instance_id);
  const { data: cues, error: cueErr } = await supabase
    .from("retroverse_track_cues")
    .select(
      "cue_id, track_instance_id, cue_number, cue_name, time_position_seconds, is_thumbnail",
    )
    .in("track_instance_id", ids)
    .eq("is_thumbnail", true)
    .order("cue_number", { ascending: true });
  if (cueErr) throw cueErr;

  const pathByInstance = new Map(instances.map((r) => [r.track_instance_id, r.file_path]));
  const rvtr = instances[0]?.retroverse_track_id ?? null;

  return (cues ?? []).map((c) => ({
    cue_id: c.cue_id,
    track_instance_id: c.track_instance_id,
    retroverse_track_id: rvtr,
    cue_number: c.cue_number,
    cue_name: c.cue_name,
    time_position_seconds: c.time_position_seconds,
    file_path: pathByInstance.get(c.track_instance_id) ?? "",
  }));
}

export async function loadPrimaryThumbnailCueForTrack(
  supabase: RetroverseSupabase,
  retroverseTrackId: string,
): Promise<ThumbnailCueRow | null> {
  const rows = await loadThumbnailCuesForTrack(supabase, retroverseTrackId);
  const cue8 = rows.find((r) => r.cue_number === 8);
  return cue8 ?? rows[0] ?? null;
}
