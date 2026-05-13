/**
 * Three-tier calibration queues — easy wins vs refinement vs retrieval failures.
 * Pure rules; safe for server loaders and analytics.
 */

import type { CandidateBreakdown, ReviewRow } from "./load-review-data";
import {
  isHardRetrievalFailure,
  isRetrievalDeadEndForHumanReview,
  meaningfulCalibrationCandidateCount,
} from "./calibration-eligibility";
import { artistsRoughlyMatch, rowHasLikelyCorrectAlternate } from "./calibration-workflow";

export type CalibrationTierId = "easy" | "calibration" | "hard";

/** Fuzzy exclusions from EASY WINS (rows reroute to CALIBRATION or stay out of easy). */
export const CALIBRATION_EASY_WINS_EXCLUSION_PATTERNS: readonly RegExp[] = [
  /\bgreatest\s+hits\b/i,
  /\bbest\s+of\b/i,
  /\bvery\s+best\b/i,
  /\banthology\b/i,
  /\bcollection\b/i,
  /\bessential\b/i,
  /\bsoundtrack\b/i,
  /\bmotion\s+picture\b/i,
  /\bdeluxe\b/i,
  /\bexpanded\b/i,
  /\bremaster/i,
  /\banniversary\b/i,
  /\blive\b/i,
  /\bunplugged\b/i,
  /\bkaraoke\b/i,
  /\btribute\b/i,
];

function pipelineMatchCandidate(row: ReviewRow): CandidateBreakdown | null {
  const a = row.matchedArtist.trim();
  const b = row.matchedAlbum.trim();
  if (!a && !b) return row.candidates[0] ?? null;
  return (
    row.candidates.find((c) => c.candidateArtist.trim() === a && c.candidateAlbum.trim() === b) ??
    row.candidates[0] ??
    null
  );
}

function allTierScanStrings(row: ReviewRow): string[] {
  const out: string[] = [
    row.billboardAlbum,
    row.billboardArtist,
    row.matchedAlbum,
    row.matchedArtist,
    row.normalizedAlbum,
    row.normalizedArtist,
    row.searchQuery,
  ];
  for (const c of row.candidates.slice(0, 12)) {
    out.push(
      c.candidateAlbum,
      c.candidateArtist,
      c.normalizedCandidateAlbum,
      c.normalizedCandidateArtist,
    );
  }
  return out.filter((s) => Boolean(s?.trim()));
}

export function isVariousArtistsStyleRow(row: ReviewRow): boolean {
  const va = /^(various\s+artists|various)$/i;
  const check = (s: string) => va.test(s.trim());
  if (check(row.billboardArtist)) return true;
  if (check(row.matchedArtist)) return true;
  return row.candidates.slice(0, 8).some((c) => check(c.candidateArtist));
}

export function rowMatchesEasyWinsExclusionKeywords(row: ReviewRow): boolean {
  if (isVariousArtistsStyleRow(row)) return true;
  const blob = allTierScanStrings(row).join("\n");
  return [...CALIBRATION_EASY_WINS_EXCLUSION_PATTERNS].some((re) => re.test(blob));
}

/** Queue 3 — retrieval debugging, last pass. */
export function isCalibrationHardTierRow(row: ReviewRow): boolean {
  if (isHardRetrievalFailure(row)) return true;
  if (isRetrievalDeadEndForHumanReview(row)) return true;
  const rej = (row.rejectionReason ?? "").trim().toLowerCase();
  if (rej === "artist_mismatch") return true;
  if (rej === "no_results") return true;
  const hasArt = Boolean(row.artworkUrl?.trim());
  const m = meaningfulCalibrationCandidateCount(row);
  if (!hasArt && m === 0) return true;
  const rawN = row.rawApiResultCount ?? 0;
  const catN = row.candidateCount ?? 0;
  if (!hasArt && rawN === 0 && catN === 0) return true;
  return false;
}

/** Queue 1 — high-throughput human calibration: obvious through medium-confidence rows (not archival purity). */
export function isEasyWinsRow(row: ReviewRow): boolean {
  if (isCalibrationHardTierRow(row)) return false;
  if (row.isSoundtrack) return false;
  if (row.isGreatestHits) return false;
  if (rowMatchesEasyWinsExclusionKeywords(row)) return false;

  const hasArt = Boolean(row.artworkUrl?.trim());
  const m = meaningfulCalibrationCandidateCount(row);
  if (!hasArt && m < 2) return false;

  const pipe = pipelineMatchCandidate(row);
  const pool = row.candidates.slice(0, 12);
  const bestPoolScore = pool.reduce((mx, c) => Math.max(mx, c.finalScore ?? -1), row.finalScore ?? -1);

  const scoreOk =
    (row.finalScore != null && row.finalScore >= 0.65) ||
    bestPoolScore >= 0.65 ||
    (row.finalScore != null && row.finalScore >= 0.6);

  const artistStrong =
    artistsRoughlyMatch(row.billboardArtist, row.matchedArtist) ||
    (pipe?.artistMatchScore != null && pipe.artistMatchScore >= 0.58) ||
    pool.some((c) => {
      const am = c.artistMatchScore;
      if (am != null && am >= 0.58) return true;
      if (am != null && am >= 0.55) return artistsRoughlyMatch(row.billboardArtist, c.candidateArtist);
      return false;
    });

  const titleClose =
    (pipe?.albumMatchScore != null && pipe.albumMatchScore >= 0.4) ||
    (pipe?.tokenOverlapScore != null && pipe.tokenOverlapScore >= 0.35) ||
    artistsRoughlyMatch(row.billboardAlbum, row.matchedAlbum) ||
    pool.some(
      (c) =>
        (c.albumMatchScore != null && c.albumMatchScore >= 0.4) ||
        (c.tokenOverlapScore != null && c.tokenOverlapScore >= 0.35) ||
        artistsRoughlyMatch(row.billboardAlbum, c.candidateAlbum),
    );

  const alternatesLikely = rowHasLikelyCorrectAlternate(row);

  const retrievalWithVisibleArt =
    hasArt &&
    ((row.rawApiResultCount ?? 0) > 0 ||
      (row.candidateCount ?? 0) > 0 ||
      pool.length > 0 ||
      bestPoolScore >= 0.55 ||
      (row.finalScore != null && row.finalScore >= 0.55));

  return scoreOk || artistStrong || titleClose || alternatesLikely || retrievalWithVisibleArt;
}

export function calibrationTierForRow(row: ReviewRow): CalibrationTierId {
  if (isCalibrationHardTierRow(row)) return "hard";
  if (isEasyWinsRow(row)) return "easy";
  return "calibration";
}

export function compareEasyWinsRows(a: ReviewRow, b: ReviewRow): number {
  const sa = a.finalScore ?? -1;
  const sb = b.finalScore ?? -1;
  if (sb !== sa) return sb - sa;
  return b.rowIndex - a.rowIndex;
}

export function compareHardTierRows(a: ReviewRow, b: ReviewRow): number {
  return b.rowIndex - a.rowIndex;
}
