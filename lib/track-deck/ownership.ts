import type { TrackDeckOwnershipState } from "./types";

/** Derive VDJ ownership from work_asset_link + vdj_asset (SQLite chart universe). */
export function resolveTrackDeckOwnership(input: {
  linkCount: number;
  maxConfidence: number | null;
  vdjPath: string | null;
}): TrackDeckOwnershipState {
  const { linkCount, maxConfidence, vdjPath } = input;
  if (linkCount <= 0) return "missing";
  if (vdjPath && maxConfidence != null && maxConfidence >= 85) return "owned";
  if (vdjPath) return "linked";
  if (linkCount > 0) return "partial";
  if (maxConfidence != null && maxConfidence < 55) return "unmatched";
  return "linked";
}
