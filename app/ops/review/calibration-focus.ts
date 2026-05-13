/**
 * Pure calibration rules — safe to import from API routes and client-free loaders.
 * Focused queue = real-world failure classes for HIL testing (~100–250 caps in loader).
 */

export type CalibrationDecisionContext = {
  reviewBucket: "verified" | "pending" | "failed";
  isLowConfidence: boolean;
  rejectionReason: string;
  isLargeYearGap: boolean;
  historicalConfidence: number | null;
  finalScore: number | null;
};

/** Matches operator-facing “teach the retriever” slice (not full corpus). */
export const FOCUSED_CALIBRATION_REJECTION_CODES = new Set([
  "artist_mismatch",
  "low_album_similarity",
  "score_below_threshold",
  "ambiguous_match",
]);

export function rowNeedsFocusedCalibrationQueue(ctx: CalibrationDecisionContext): boolean {
  if (ctx.reviewBucket === "failed") return true;
  if (ctx.isLowConfidence) return true;
  const rej = ctx.rejectionReason.trim().toLowerCase();
  if (rej && FOCUSED_CALIBRATION_REJECTION_CODES.has(rej)) return true;
  return false;
}

/** Lower = review first (hardest failures). */
export function calibrationQueuePriority(ctx: CalibrationDecisionContext): number {
  const rej = ctx.rejectionReason.trim().toLowerCase();
  if (ctx.reviewBucket === "failed") return 0;
  if (rej === "ambiguous_match") return 1;
  if (rej === "artist_mismatch") return 2;
  if (rej === "low_album_similarity") return 3;
  if (rej === "score_below_threshold") return 4;
  if (ctx.isLowConfidence) return 5;
  return 100;
}

/** Tags for JSONL / analytics — what was wrong before the human acted. */
export function calibrationTagsForRow(ctx: CalibrationDecisionContext): string[] {
  const tags: string[] = [];
  if (ctx.reviewBucket === "failed") tags.push("failed");
  if (ctx.isLowConfidence) tags.push("low_confidence");
  const rej = ctx.rejectionReason.trim().toLowerCase();
  if (rej) tags.push(`rejection:${rej}`);
  if (ctx.isLargeYearGap) tags.push("large_year_gap");
  const hc = ctx.historicalConfidence;
  if (hc != null && hc < 0.55) tags.push("historical_weak");
  const fs = ctx.finalScore;
  if (fs != null && fs < 0.85) tags.push("score_low");
  return [...new Set(tags)];
}

export function calibrationContextFromDecisionBody(body: {
  reviewBucket?: string;
  isLowConfidence?: boolean;
  rejectionReason?: string;
  isLargeYearGap?: boolean;
  historicalConfidence?: number | null;
  finalScoreSnapshot?: number | null;
}): CalibrationDecisionContext {
  const b = (body.reviewBucket ?? "pending") as CalibrationDecisionContext["reviewBucket"];
  const bucket = b === "verified" || b === "pending" || b === "failed" ? b : "pending";
  return {
    reviewBucket: bucket,
    isLowConfidence: Boolean(body.isLowConfidence),
    rejectionReason: body.rejectionReason ?? "",
    isLargeYearGap: Boolean(body.isLargeYearGap),
    historicalConfidence: body.historicalConfidence ?? null,
    finalScore: body.finalScoreSnapshot ?? null,
  };
}
