/**
 * Human calibration workflow — retrieval vs ranking vs hard failure.
 * Safe for client + server (no Node-only imports).
 */

import type { CandidateBreakdown, ReviewRow } from "./load-review-data";

export type HumanCalSummary = {
  headline: string;
  lines: string[];
  tone: "bad" | "warn" | "good" | "muted";
  /** True when a non-primary candidate looks like the right release (ranking failure). */
  likelyCorrectAlternate: boolean;
};

function normRough(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function artistsRoughlyMatch(billboard: string, matched: string): boolean {
  const b = normRough(billboard);
  const m = normRough(matched);
  if (!m || !b) return false;
  if (m === b) return true;
  if (b.includes(m) || m.includes(b)) return true;
  return false;
}

function sameAsPipeline(c: CandidateBreakdown, row: ReviewRow): boolean {
  const a = c.candidateArtist.trim();
  const alb = c.candidateAlbum.trim();
  return a === row.matchedArtist.trim() && alb === row.matchedAlbum.trim();
}

/**
 * Another candidate in the pool strongly aligns with Billboard text + year.
 * Signals: retrieval worked — ranking may have picked the wrong row.
 */
export function rowHasLikelyCorrectAlternate(row: ReviewRow): boolean {
  if (row.candidates.length < 2) return false;
  for (const c of row.candidates) {
    if (sameAsPipeline(c, row)) continue;
    const am = c.artistMatchScore;
    const bm = c.albumMatchScore;
    const tok = c.tokenOverlapScore;
    const artistStrong = am == null || am >= 0.72;
    if (!artistStrong) continue;
    const titleStrong =
      (bm != null && bm >= 0.74) ||
      (tok != null && tok >= 0.62) ||
      artistsRoughlyMatch(row.billboardAlbum, c.candidateAlbum);
    if (!titleStrong) continue;
    const yd = c.releaseYearDistance;
    if (yd != null && Math.abs(yd) > 6) continue;
    return true;
  }
  return false;
}

/** Lower = earlier in calibration queue (higher operator value). */
export function calibrationWorkflowPriorityFromRow(row: ReviewRow): number {
  const rej = (row.rejectionReason ?? "").trim().toLowerCase();
  const artistAlbumFailed = rej === "low_album_similarity" && artistsRoughlyMatch(row.billboardArtist, row.matchedArtist);
  if (rowHasLikelyCorrectAlternate(row)) return 0;
  if (artistAlbumFailed) return 1;
  if (rej === "ambiguous_match") return 2;
  if (rej === "compilation_noise" || rej === "remaster_noise") return 3;
  if (row.isLargeYearGap) return 4;
  if (rej === "score_below_threshold") return 5;
  if (rej === "artist_mismatch") return 6;
  if (row.isLowConfidence) return 7;
  if (row.reviewBucket === "failed") return 8;
  return 50;
}

export function compareCalibrationWorkflowRows(a: ReviewRow, b: ReviewRow): number {
  const pa = calibrationWorkflowPriorityFromRow(a);
  const pb = calibrationWorkflowPriorityFromRow(b);
  if (pa !== pb) return pa - pb;
  return b.rowIndex - a.rowIndex;
}

/**
 * Operator-facing state copy only. Raw `rejectionReason` stays in technical debug.
 */
export function humanWorkflowCalibrationSummary(row: ReviewRow): HumanCalSummary {
  const rej = (row.rejectionReason ?? "").trim().toLowerCase();
  const ma = row.matchedArtist ?? "";
  const rawN = row.rawApiResultCount ?? 0;
  const catN = row.candidateCount ?? 0;
  const likelyCorrectAlternate = rowHasLikelyCorrectAlternate(row);

  if (likelyCorrectAlternate) {
    return {
      headline: "CORRECT MATCH MAY ALREADY BE IN ALTERNATES",
      lines: [
        "Retrieval returned usable rows — the hero may not be the best-ranked one.",
        "Scan the strip: if a thumbnail matches Billboard, click it to promote, then accept.",
      ],
      tone: "warn",
      likelyCorrectAlternate: true,
    };
  }

  if (row.reviewBucket === "verified" && row.accepted && !row.isLowConfidence && !row.isLargeYearGap) {
    return {
      headline: "CORRECT MATCH FOUND",
      lines: ["Pipeline accepted this catalogue row with strong scores."],
      tone: "good",
      likelyCorrectAlternate: false,
    };
  }

  if (rej === "no_results" || (rawN === 0 && catN === 0 && !row.artworkUrl?.trim())) {
    return {
      headline: "NO USABLE RESULTS",
      lines: [
        "Nothing came back from the catalogue that you can compare here.",
        "Hard failure for this screen — use batch escalation, not visual ranking.",
      ],
      tone: "bad",
      likelyCorrectAlternate: false,
    };
  }

  if (row.reviewBucket === "failed" && rej !== "no_results" && (rawN > 0 || catN > 0 || row.candidates.length > 0)) {
    return {
      headline: "RETRIEVAL WORKED — AUTO-RULES REJECTED",
      lines: [
        "The API returned candidates but the matcher would not accept them.",
        "Compare art and alternates, or adjust search (Artist + Album, Broad, Ignore Year).",
      ],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (row.isLargeYearGap) {
    return {
      headline: "YEAR CONFLICT",
      lines: [
        `Chart year ${row.chartYear} vs catalogue ${row.matchedReleaseYear ?? "—"} — reissue or wrong era.`,
        "If the title looks right, check alternates or Discogs for another pressing year.",
      ],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (rej === "artist_mismatch") {
    return {
      headline: "ARTIST MATCH FAILED ON LEAD HIT",
      lines: [
        "The top result may not be the same act as on the Billboard side.",
        "Check alternates; if none match, broaden search or use Discogs recovery.",
      ],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (rej === "low_album_similarity") {
    const artistOk = artistsRoughlyMatch(row.billboardArtist, ma);
    return {
      headline: artistOk ? "ARTIST MATCHED / ALBUM FAILED" : "TITLE DOES NOT LINE UP",
      lines: [
        artistOk
          ? "Artist aligns; the catalogue album title is not close to the chart name."
          : "Artist and album titles both diverge — wrong release family or bad query.",
        "Ranking may be wrong if an alternate looks visually correct.",
      ],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (rej === "ambiguous_match") {
    return {
      headline: "RELATED RELEASES FOUND",
      lines: [
        "Several rows scored close — uncertain automatic ranking.",
        "Pick the cover that matches the Billboard album.",
      ],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (rej === "score_below_threshold") {
    return {
      headline: "LOW CONFIDENCE LEAD — RETRY MAY HELP",
      lines: [
        "Best pick is under the auto-accept bar.",
        "Confirm on artwork first; if strip is weak, try another search strategy.",
      ],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (rej === "compilation_noise" || rej === "remaster_noise") {
    return {
      headline: "WRONG RELEASE FAMILY",
      lines: [
        "Looks like a compilation, remaster, or side release — not the core album.",
        "Check alternates for an original listing.",
      ],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (rej === "single_or_ep") {
    return {
      headline: "WRONG RELEASE TYPE",
      lines: ["Hit is a single or EP, not the chart album.", "Use alternates or a new search."],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  if (row.reviewBucket === "failed") {
    return {
      headline: "HARD FAILURE",
      lines: ["No acceptable automatic state — treat as escalation.", "Not a ranking-only fix."],
      tone: "bad",
      likelyCorrectAlternate: false,
    };
  }

  if (row.isLowConfidence) {
    return {
      headline: "NEAR MISS — NEEDS CONFIRMATION",
      lines: ["Scores or history are weak — trust your eyes on the cover and titles."],
      tone: "warn",
      likelyCorrectAlternate: false,
    };
  }

  return {
    headline: "REVIEW MATCH",
    lines: ["Compare hero to Billboard data; promote an alternate if it is clearly right."],
    tone: "muted",
    likelyCorrectAlternate: false,
  };
}
