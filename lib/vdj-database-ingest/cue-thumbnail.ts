/** Locked Retroverse rule: VirtualDJ cue 8 = canonical thumbnail identity. */

export type ThumbnailCueReason = "cue8" | "name" | null;

export function thumbnailReasonFromCue(
  cueNumber: number,
  cueName: string | null | undefined,
): ThumbnailCueReason {
  if (cueNumber === 8) return "cue8";
  const name = (cueName ?? "").trim().toLowerCase();
  if (!name) return null;
  if (name.includes("thumbnail") || name.includes("thumb")) return "name";
  return null;
}

export function isThumbnailCue(cueNumber: number, cueName: string | null | undefined): boolean {
  return thumbnailReasonFromCue(cueNumber, cueName) !== null;
}
