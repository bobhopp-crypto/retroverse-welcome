/** Local VirtualDJ video library root (filename scan for curator suggestions). */
export const DEFAULT_VDJ_MEDIA_ROOT = "/Users/bobhopp/DJ MEDIA/VIDEO";

export function vdjMediaRoot(): string {
  return process.env.VDJ_MEDIA_ROOT?.trim() || DEFAULT_VDJ_MEDIA_ROOT;
}

export const TRACK_CURATOR_DECISIONS_PATH =
  process.env.TRACK_CURATOR_DECISIONS_PATH?.trim() ||
  "data/track-curator-decisions.json";
