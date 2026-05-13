import fs from "node:fs";
import path from "node:path";

import {
  collectionIdAsNumber,
  pickArtworkUrlFromRow,
} from "./itunes-snapshot-artwork";

export type ReviewBucket = "verified" | "pending" | "failed";

export type CandidateBreakdown = {
  candidateArtist: string;
  candidateAlbum: string;
  normalizedCandidateArtist: string;
  normalizedCandidateAlbum: string;
  artistMatchScore: number | null;
  albumMatchScore: number | null;
  tokenOverlapScore: number | null;
  yearDistanceScore: number | null;
  compilationPenalty: number | null;
  remasterPenalty: number | null;
  tributePenalty: number | null;
  karaokePenalty: number | null;
  singlePenalty: number | null;
  epPenalty: number | null;
  releaseYearDistance: number | null;
  historicalYearDistanceScore: number | null;
  historicalConfidence: number | null;
  historicalPenaltyReason: string;
  finalScore: number | null;
  acceptedForRanking: boolean;
  rejectedReason: string;
  /** iTunes collection trackCount when present (candidates CSV `itunes_track_count`). */
  itunesTrackCount: number | null;
  /** First sampled track titles from catalog (` ;; `-joined in CSV). */
  trackSample: string[];
  /** Script overlap 0–1 (CSV `track_overlap_score`; secondary sort / debug). */
  trackOverlapScore: number | null;
};

export type ReviewRow = {
  id: string;
  rowIndex: number;
  billboardArtist: string;
  billboardAlbum: string;
  chartYear: number;
  normalizedArtist: string;
  normalizedAlbum: string;
  matchedAlbum: string;
  matchedArtist: string;
  matchedReleaseYear: number | null;
  matchedCollectionId: string;
  finalScore: number | null;
  accepted: boolean;
  rejectionReason: string;
  releaseYearDelta: number | null;
  historicalConfidence: number | null;
  historicalPenaltyReason: string;
  artworkUrl: string | null;
  rawSnapshotPaths: string[];
  retryStrategy: string;
  searchQuery: string;
  fetchStrategyTaxonomy: string;
  apiQueryUrl: string;
  candidateCount: number | null;
  /** iTunes `resultCount` from last API response (attempts CSV `raw_api_result_count`). */
  rawApiResultCount: number | null;
  elapsedMs: number | null;
  reviewBucket: ReviewBucket;
  isSoundtrack: boolean;
  isGreatestHits: boolean;
  isLargeYearGap: boolean;
  isLowConfidence: boolean;
  candidates: CandidateBreakdown[];
  /** Operator calibration queue (from calibration_row_state.json). */
  calibrationQueueState?: string;
  calibrationEscalationStage?: number;
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let i = 0;
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    if (row.length > 1 || row[0] !== "") {
      rows.push(row);
    }
    row = [];
  };

  while (i < text.length) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ",") {
      pushField();
      i++;
      continue;
    }
    if (c === "\n") {
      pushField();
      pushRow();
      i++;
      continue;
    }
    if (c === "\r") {
      pushField();
      if (text[i + 1] === "\n") {
        i++;
      }
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  pushField();
  if (row.length) {
    pushRow();
  }
  return rows;
}

function normalizeHeaderRow(headers: string[]): string[] {
  return headers.map((h) => h.replace(/^\uFEFF/, "").trim());
}

function rowsToObjects(headers: string[], lines: string[][]): Record<string, string>[] {
  return lines.map((cells) => {
    const o: Record<string, string> = {};
    headers.forEach((h, idx) => {
      o[h] = cells[idx] ?? "";
    });
    return o;
  });
}

function num(s: string): number | null {
  if (s == null || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function bool(s: string): boolean {
  return s.trim().toLowerCase() === "true";
}

function releaseYearFromIso(iso: string): number | null {
  if (!iso || !iso.trim()) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

function parseSnapshotPaths(cell: string): string[] {
  return cell
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
}

function billboardKey(artist: string, album: string): string {
  return `${artist}\n${album}`;
}

function hasGreatestHits(artist: string, album: string, matchedAlbum: string): boolean {
  const h = /greatest\s+hits|best of\b/i;
  return h.test(album) || h.test(matchedAlbum) || h.test(artist);
}

function readArtworkForPath(
  absoluteRawPath: string,
  collectionId: string,
  cache: Map<string, string | null>,
): string | null {
  const wantId = collectionIdAsNumber(collectionId);
  const cacheKey = `${absoluteRawPath}\t${wantId ?? "first"}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)!;
  }
  let url: string | null = null;
  try {
    const raw = fs.readFileSync(absoluteRawPath, "utf8");
    const parsed = JSON.parse(raw) as {
      results?: Array<Record<string, unknown>>;
    };
    const results = parsed.results;
    type Row = Record<string, unknown>;
    if (results?.length) {
      const rows = results as Row[];
      if (wantId != null) {
        const hit = rows.find((r) => collectionIdAsNumber(r.collectionId) === wantId);
        if (hit) {
          url = pickArtworkUrlFromRow(hit);
        }
      }
      if (!url) {
        const album = rows.find((r) => r.wrapperType === "collection");
        url = pickArtworkUrlFromRow(album ?? rows[0] ?? {});
      }
    }
  } catch {
    url = null;
  }
  cache.set(cacheKey, url);
  return url;
}

function classifyBucket(
  accepted: boolean,
  finalScore: number | null,
  releaseYearDelta: number | null,
): ReviewBucket {
  if (!accepted) return "failed";
  const scoreOk = finalScore != null && finalScore >= 0.95;
  const yearOk =
    releaseYearDelta == null ? true : Math.abs(releaseYearDelta) <= 3;
  if (scoreOk && yearOk) return "verified";
  return "pending";
}

/** When candidate CSV rows are missing for an attempt (mixed runs, truncated export), keep the review row usable. */
function syntheticCandidatesFromAttempt(o: Record<string, string>, finalScore: number | null, accepted: boolean): CandidateBreakdown[] {
  const selArtist = (o.selected_artist ?? "").trim();
  const selAlbum = (o.selected_candidate ?? "").trim();
  if (!selArtist && !selAlbum) return [];
  return [
    {
      candidateArtist: selArtist,
      candidateAlbum: selAlbum,
      normalizedCandidateArtist: "",
      normalizedCandidateAlbum: "",
      artistMatchScore: null,
      albumMatchScore: null,
      tokenOverlapScore: null,
      yearDistanceScore: null,
      compilationPenalty: null,
      remasterPenalty: null,
      tributePenalty: null,
      karaokePenalty: null,
      singlePenalty: null,
      epPenalty: null,
      releaseYearDistance: null,
      historicalYearDistanceScore: null,
      historicalConfidence: null,
      historicalPenaltyReason: "",
      finalScore,
      acceptedForRanking: accepted,
      rejectedReason: o.rejection_reason ?? "",
      itunesTrackCount: null,
      trackSample: [],
      trackOverlapScore: null,
    },
  ];
}

function splitTrackSampleCell(cell: string): string[] {
  const s = (cell ?? "").trim();
  if (!s) return [];
  return s
    .split(" ;; ")
    .map((t) => t.trim())
    .filter(Boolean);
}

function candidateFromRow(o: Record<string, string>): CandidateBreakdown {
  return {
    candidateArtist: o.candidate_artist ?? "",
    candidateAlbum: o.candidate_album ?? "",
    normalizedCandidateArtist: o.normalized_candidate_artist ?? "",
    normalizedCandidateAlbum: o.normalized_candidate_album ?? "",
    artistMatchScore: num(o.artist_match_score ?? ""),
    albumMatchScore: num(o.album_match_score ?? ""),
    tokenOverlapScore: num(o.token_overlap_score ?? ""),
    yearDistanceScore: num(o.year_distance_score ?? ""),
    compilationPenalty: num(o.compilation_penalty ?? ""),
    remasterPenalty: num(o.remaster_penalty ?? ""),
    tributePenalty: num(o.tribute_penalty ?? ""),
    karaokePenalty: num(o.karaoke_penalty ?? ""),
    singlePenalty: num(o.single_penalty ?? ""),
    epPenalty: num(o.ep_penalty ?? ""),
    releaseYearDistance: num(o.release_year_distance ?? ""),
    historicalYearDistanceScore: num(o.historical_year_distance_score ?? ""),
    historicalConfidence: num(o.historical_confidence ?? ""),
    historicalPenaltyReason: o.historical_penalty_reason ?? "",
    finalScore: num(o.final_score ?? ""),
    acceptedForRanking: bool(o.accepted_for_ranking ?? "false"),
    rejectedReason: o.rejected_reason ?? "",
    itunesTrackCount: num(o.itunes_track_count ?? ""),
    trackSample: splitTrackSampleCell(o.track_sample ?? ""),
    trackOverlapScore: num(o.track_overlap_score ?? ""),
  };
}

const ATTEMPTS_REL = "data/diagnostics/itunes/itunes_attempts_v2.csv";
const CANDIDATES_REL = "data/diagnostics/itunes/itunes_candidates_v3.csv";

const REQUIRED_CANDIDATE_COLS = ["billboard_artist", "billboard_album", "candidate_artist", "candidate_album", "final_score"] as const;

export type ReviewDataLoadStats = {
  attemptsRel: string;
  candidatesRel: string;
  attemptsPathAbs: string;
  candidatesPathAbs: string;
  attemptsFileExists: boolean;
  candidatesFileExists: boolean;
  parsed_attempt_count: number;
  parsed_candidate_count: number;
  unique_candidate_billboard_keys: number;
  joined_review_rows: number;
  rows_empty_candidates_before_fallback: number;
  rows_used_synthetic_candidates: number;
  candidate_required_columns_ok: boolean;
  attempts_header: string[];
  candidates_header: string[];
};

export type AlbumReviewPipelineDiagnostics = ReviewDataLoadStats & {
  /** Calibration queue: ambiguous / failed / low-confidence rows only (newest deduped first). */
  queue_count: number;
  /** All deduped rows before calibration filter. */
  deduped_review_count: number;
  /** Rows dropped by calibration filter (high-confidence verified matches). */
  calibration_excluded_count: number;
  /** Mode match but excluded: no artwork and fewer than two meaningful candidates (retrieval-escalation work). */
  calibration_retrieval_dead_end_excluded_count: number;
  /** Empty retrieval (no art, no candidates, no API results) — skipped; batch-escalate only. */
  calibration_hard_failure_bucket_count: number;
  /** `focused` = failure-class test slice; `legacy` = broader rowNeedsSearchCalibration. */
  calibration_queue_mode: "focused" | "legacy";
  /** Max rows served to the UI (env ITUNES_CALIBRATION_QUEUE_CAP, default 250). */
  calibration_queue_cap: number;
  /** Rows matching filter before cap. */
  calibration_queue_pre_cap_count: number;
  /** Three-tier queues (optional — set by tier loader). */
  calibration_tier_easy_pre_cap_count?: number;
  calibration_tier_calibration_pre_cap_count?: number;
  calibration_tier_hard_pre_cap_count?: number;
  calibration_tier_easy_queue_count?: number;
  calibration_tier_calibration_queue_count?: number;
  calibration_tier_hard_queue_count?: number;
  /** Rows removed from queue by human/auto resolved calibration state file. */
  calibration_state_resolved_count?: number;
};

/** Calibration rerun taxonomy — maps to `ITUNES_FILL_CALIBRATION_STRATEGY` in fill script. */
export type CalibrationRetryStrategyId =
  | "artist_only"
  | "artist_album"
  | "broad_search"
  | "loose_match"
  | "title_only"
  | "ignore_year";

/** Rejection taxonomy keys from iTunes fill — retrieval failure classes for calibration. */
const CALIBRATION_REJECTION_CODES = new Set([
  "no_results",
  "artist_mismatch",
  "low_album_similarity",
  "score_below_threshold",
  "ambiguous_match",
  "compilation_noise",
  "remaster_noise",
  "invalid_release_type",
  "single_or_ep",
]);

/**
 * Default queue for search calibration: failed, low-confidence, rejection-class mismatches,
 * large chart–release gap, or weak historical confidence.
 * For a tighter HIL test slice see `rowNeedsFocusedCalibrationQueue` in ./calibration-focus.ts.
 */
export function rowNeedsSearchCalibration(row: ReviewRow): boolean {
  if (row.reviewBucket === "failed") return true;
  if (row.isLowConfidence) return true;
  const rej = (row.rejectionReason ?? "").trim().toLowerCase();
  if (rej && CALIBRATION_REJECTION_CODES.has(rej)) return true;
  if (row.isLargeYearGap) return true;
  const hc = row.historicalConfidence;
  if (hc != null && hc < 0.55) return true;
  return false;
}

export function loadReviewDataAndStats(): { rows: ReviewRow[]; stats: ReviewDataLoadStats } {
  const root = process.cwd();
  const attemptsPathAbs = path.join(root, ATTEMPTS_REL);
  const candidatesPathAbs = path.join(root, CANDIDATES_REL);
  const attemptsFileExists = fs.existsSync(attemptsPathAbs);
  const candidatesFileExists = fs.existsSync(candidatesPathAbs);

  const emptyStats = (partial: Partial<ReviewDataLoadStats>): ReviewDataLoadStats => ({
    attemptsRel: ATTEMPTS_REL,
    candidatesRel: CANDIDATES_REL,
    attemptsPathAbs,
    candidatesPathAbs,
    attemptsFileExists,
    candidatesFileExists,
    parsed_attempt_count: 0,
    parsed_candidate_count: 0,
    unique_candidate_billboard_keys: 0,
    joined_review_rows: 0,
    rows_empty_candidates_before_fallback: 0,
    rows_used_synthetic_candidates: 0,
    candidate_required_columns_ok: false,
    attempts_header: [],
    candidates_header: [],
    ...partial,
  });

  if (!attemptsFileExists || !candidatesFileExists) {
    return { rows: [], stats: emptyStats({}) };
  }

  const attemptsGrid = parseCsv(fs.readFileSync(attemptsPathAbs, "utf8"));
  const attemptsHeaderRaw = attemptsGrid[0];
  if (!attemptsHeaderRaw) {
    return { rows: [], stats: emptyStats({}) };
  }
  const attemptsHeader = normalizeHeaderRow(attemptsHeaderRaw);
  const attemptObjs = rowsToObjects(attemptsHeader, attemptsGrid.slice(1));

  const candGrid = parseCsv(fs.readFileSync(candidatesPathAbs, "utf8"));
  const candHeaderRaw = candGrid[0];
  const candHeader = candHeaderRaw ? normalizeHeaderRow(candHeaderRaw) : [];
  const candObjs = candHeader.length ? rowsToObjects(candHeader, candGrid.slice(1)) : [];
  const candidate_required_columns_ok = REQUIRED_CANDIDATE_COLS.every((c) => candHeader.includes(c));

  const byBillboard = new Map<string, CandidateBreakdown[]>();
  for (const co of candObjs) {
    const k = billboardKey(co.billboard_artist ?? "", co.billboard_album ?? "");
    if (!byBillboard.has(k)) byBillboard.set(k, []);
    byBillboard.get(k)!.push(candidateFromRow(co));
  }

  for (const [, list] of byBillboard) {
    list.sort((a, b) => {
      const fa = a.finalScore ?? -1;
      const fb = b.finalScore ?? -1;
      if (fb !== fa) return fb - fa;
      const ta = a.trackOverlapScore ?? -1;
      const tb = b.trackOverlapScore ?? -1;
      return tb - ta;
    });
  }

  const artworkCache = new Map<string, string | null>();
  const out: ReviewRow[] = [];
  let rows_empty_candidates_before_fallback = 0;
  let rows_used_synthetic_candidates = 0;

  attemptObjs.forEach((o, idx) => {
    const billboardArtist = o.billboard_artist ?? "";
    const billboardAlbum = o.billboard_album ?? "";
    const chartYear = num(o.chart_year ?? "") ?? 0;
    const normalizedArtist = o.normalized_artist ?? "";
    const normalizedAlbum = o.normalized_album ?? "";
    const matchedAlbum = o.selected_candidate ?? "";
    const matchedArtist = o.selected_artist ?? "";
    const releaseYear = releaseYearFromIso(o.selected_release_date ?? "");
    const releaseYearDelta =
      releaseYear != null && chartYear ? releaseYear - chartYear : null;
    const finalScore = num(o.final_score ?? "");
    const accepted = bool(o.accepted ?? "false");
    const rejectionReason = o.rejection_reason ?? "";
    const reviewBucket = classifyBucket(accepted, finalScore, releaseYearDelta);

    const k = billboardKey(billboardArtist, billboardAlbum);
    let candidates = byBillboard.get(k) ?? [];
    if (candidates.length === 0) {
      rows_empty_candidates_before_fallback += 1;
      const synthetic = syntheticCandidatesFromAttempt(o, finalScore, accepted);
      if (synthetic.length > 0) {
        candidates = synthetic;
        rows_used_synthetic_candidates += 1;
      }
    }

    let historicalConfidence: number | null = null;
    let historicalPenaltyReason = "";
    const selArtist = matchedArtist.trim();
    const selAlbum = matchedAlbum.trim();
    if (selArtist || selAlbum) {
      const hit = candidates.find(
        (c) =>
          c.candidateArtist.trim() === selArtist &&
          c.candidateAlbum.trim() === selAlbum,
      );
      if (hit) {
        historicalConfidence = hit.historicalConfidence;
        historicalPenaltyReason = hit.historicalPenaltyReason;
      }
    }

    const rawSnapshotPaths = parseSnapshotPaths(o.raw_snapshot_path ?? "");
    let artworkUrl: string | null = null;
    const firstRel = rawSnapshotPaths[0];
    if (firstRel) {
      const abs = path.join(root, firstRel);
      artworkUrl = readArtworkForPath(abs, o.selected_collection_id ?? "", artworkCache);
    }

    const isSoundtrack = /^soundtrack$/i.test(billboardArtist.trim());
    const isGreatestHits = hasGreatestHits(billboardArtist, billboardAlbum, matchedAlbum);
    const isLargeYearGap =
      releaseYearDelta != null && Math.abs(releaseYearDelta) > 5;
    const isLowConfidence =
      (historicalConfidence != null && historicalConfidence < 0.5) ||
      (finalScore != null && finalScore < 0.85);

    out.push({
      id: `r${idx}`,
      rowIndex: idx,
      billboardArtist,
      billboardAlbum,
      chartYear,
      normalizedArtist,
      normalizedAlbum,
      matchedAlbum,
      matchedArtist,
      matchedReleaseYear: releaseYear,
      matchedCollectionId: o.selected_collection_id ?? "",
      finalScore,
      accepted,
      rejectionReason,
      releaseYearDelta,
      historicalConfidence,
      historicalPenaltyReason,
      artworkUrl,
      rawSnapshotPaths,
      retryStrategy: o.retry_strategy ?? "",
      searchQuery: o.search_query ?? "",
      fetchStrategyTaxonomy: o.fetch_strategy_taxonomy ?? "",
      apiQueryUrl: o.api_query_url ?? "",
      candidateCount: num(o.candidate_count ?? ""),
      rawApiResultCount: num(o.raw_api_result_count ?? ""),
      elapsedMs: num(o.elapsed_ms ?? ""),
      reviewBucket,
      isSoundtrack,
      isGreatestHits,
      isLargeYearGap,
      isLowConfidence,
      candidates,
    });
  });

  const stats = emptyStats({
    parsed_attempt_count: attemptObjs.length,
    parsed_candidate_count: candObjs.length,
    unique_candidate_billboard_keys: byBillboard.size,
    joined_review_rows: out.length,
    rows_empty_candidates_before_fallback,
    rows_used_synthetic_candidates,
    candidate_required_columns_ok,
    attempts_header: attemptsHeader,
    candidates_header: candHeader,
  });

  return { rows: out, stats };
}

export function loadReviewData(): ReviewRow[] {
  return loadReviewDataAndStats().rows;
}
