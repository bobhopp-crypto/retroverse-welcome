import type { ReviewRow } from "./load-review-data";

/** Candidates with at least one displayable title (artist and/or album). */
export function meaningfulCalibrationCandidateCount(row: ReviewRow): number {
  return row.candidates.filter((c) => c.candidateArtist.trim() || c.candidateAlbum.trim()).length;
}

/**
 * Pure retrieval-engine work: the workstation would show a blank hero and at most one label.
 * Exclude from human calibration until escalation yields artwork or multiple plausible picks.
 *
 * Include in human queue when:
 * - there is artwork to review, or
 * - at least two meaningful ranked candidates to compare (text-only ambiguity).
 */
export function isRetrievalDeadEndForHumanReview(row: ReviewRow): boolean {
  const hasArt = Boolean(row.artworkUrl?.trim());
  const m = meaningfulCalibrationCandidateCount(row);
  if (hasArt) return false;
  if (m >= 2) return false;
  return true;
}

/**
 * True empty retrieval: no artwork, no ranked candidates, API returned nothing scorable.
 * Routed to hard-failure bucket — not shown in visual calibration.
 */
export function isHardRetrievalFailure(row: ReviewRow): boolean {
  const hasArt = Boolean(row.artworkUrl?.trim());
  const m = meaningfulCalibrationCandidateCount(row);
  if (hasArt || m > 0) return false;
  const rawN = row.rawApiResultCount ?? 0;
  const catN = row.candidateCount ?? 0;
  const rej = (row.rejectionReason ?? "").trim().toLowerCase();
  if (rej === "no_results") return true;
  if (rawN === 0 && catN === 0) return true;
  return false;
}
