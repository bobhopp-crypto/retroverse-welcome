import {
  billboardStateKey,
  defaultRowState,
  isCalibrationRowComplete,
  loadCalibrationStateMapSync,
  shouldForceHardTierForDiscogs,
} from "@/app/ops/itunes-album-review/calibration-state";
import { rowNeedsFocusedCalibrationQueue, type CalibrationDecisionContext } from "../review/calibration-focus";
import {
  compareEasyWinsRows,
  compareHardTierRows,
  type CalibrationTierId,
  calibrationTierForRow,
} from "../review/calibration-tiers";
import { compareCalibrationWorkflowRows } from "../review/calibration-workflow";
import {
  isHardRetrievalFailure,
  isRetrievalDeadEndForHumanReview,
} from "../review/calibration-eligibility";
import {
  loadReviewDataAndStats,
  type AlbumReviewPipelineDiagnostics,
  type ReviewRow,
  rowNeedsSearchCalibration,
} from "../review/load-review-data";

export type CalibrationTierQueues = Record<CalibrationTierId, ReviewRow[]>;

function dedupeNewestFirst(all: ReviewRow[]): ReviewRow[] {
  const byKey = new Map<string, ReviewRow>();
  for (const row of all) {
    const k = `${row.billboardArtist}\n${row.billboardAlbum}`;
    const prev = byKey.get(k);
    if (!prev || row.rowIndex > prev.rowIndex) {
      byKey.set(k, row);
    }
  }
  return [...byKey.values()].sort((a, b) => b.rowIndex - a.rowIndex);
}

function rowToCalibrationContext(row: ReviewRow): CalibrationDecisionContext {
  return {
    reviewBucket: row.reviewBucket,
    isLowConfidence: row.isLowConfidence,
    rejectionReason: row.rejectionReason ?? "",
    isLargeYearGap: row.isLargeYearGap,
    historicalConfidence: row.historicalConfidence,
    finalScore: row.finalScore,
  };
}

function parseQueueCap(): number {
  const raw = process.env.ITUNES_CALIBRATION_QUEUE_CAP?.trim();
  const n = raw ? parseInt(raw, 10) : 250;
  if (!Number.isFinite(n)) return 250;
  return Math.min(500, Math.max(50, n));
}

function parseQueueMode(): "focused" | "legacy" {
  return process.env.ITUNES_CALIBRATION_QUEUE_MODE?.trim().toLowerCase() === "legacy" ? "legacy" : "focused";
}

/** Queue row(s) plus loader diagnostics for empty-state / debugging. */
export type { AlbumReviewPipelineDiagnostics };

/**
 * Three-tier calibration: easy wins (default), calibration refinement, hard failures.
 * Hard / dead-end rows are included in the "hard" queue instead of being dropped.
 */
export function loadCalibrationTierQueuesWithDiagnostics(): {
  queues: CalibrationTierQueues;
  pipeline: AlbumReviewPipelineDiagnostics;
} {
  const { rows: joined, stats } = loadReviewDataAndStats();
  const deduped = dedupeNewestFirst(joined);
  const mode = parseQueueMode();
  const cap = parseQueueCap();

  const pipelineFiltered = deduped.filter((row) =>
    mode === "legacy" ? rowNeedsSearchCalibration(row) : rowNeedsFocusedCalibrationQueue(rowToCalibrationContext(row)),
  );

  const stateMap = loadCalibrationStateMapSync();
  const filtered = pipelineFiltered.filter((row) => {
    const st = stateMap[billboardStateKey(row.billboardArtist, row.billboardAlbum)];
    return !isCalibrationRowComplete(st);
  });

  const withCalibration: ReviewRow[] = filtered.map((row) => {
    const k = billboardStateKey(row.billboardArtist, row.billboardAlbum);
    const st = stateMap[k] ?? defaultRowState();
    return {
      ...row,
      calibrationQueueState: st.state,
      calibrationEscalationStage: st.escalationStage,
    };
  });

  const tierEasy: ReviewRow[] = [];
  const tierCal: ReviewRow[] = [];
  const tierHard: ReviewRow[] = [];

  for (const row of withCalibration) {
    const k = billboardStateKey(row.billboardArtist, row.billboardAlbum);
    const st = stateMap[k];
    const t: CalibrationTierId = shouldForceHardTierForDiscogs(st) ? "hard" : calibrationTierForRow(row);
    if (t === "easy") tierEasy.push(row);
    else if (t === "hard") tierHard.push(row);
    else tierCal.push(row);
  }

  tierEasy.sort(compareEasyWinsRows);
  tierCal.sort(compareCalibrationWorkflowRows);
  tierHard.sort(compareHardTierRows);

  const easy = tierEasy.slice(0, cap);
  const calibration = tierCal.slice(0, cap);
  const hard = tierHard.slice(0, cap);

  const afterHardFailure = pipelineFiltered.filter((row) => !isHardRetrievalFailure(row));
  const afterRetrievalGate = afterHardFailure.filter((row) => !isRetrievalDeadEndForHumanReview(row));

  const legacySingleQueue = [...afterRetrievalGate].sort(compareCalibrationWorkflowRows).slice(0, cap);
  const stateResolvedCount = pipelineFiltered.length - filtered.length;

  return {
    queues: { easy, calibration, hard },
    pipeline: {
      ...stats,
      queue_count: legacySingleQueue.length,
      deduped_review_count: deduped.length,
      calibration_excluded_count: deduped.length - pipelineFiltered.length,
      calibration_state_resolved_count: stateResolvedCount,
      calibration_hard_failure_bucket_count: pipelineFiltered.length - afterHardFailure.length,
      calibration_retrieval_dead_end_excluded_count: afterHardFailure.length - afterRetrievalGate.length,
      calibration_queue_mode: mode,
      calibration_queue_cap: cap,
      calibration_queue_pre_cap_count: legacySingleQueue.length,
      calibration_tier_easy_pre_cap_count: tierEasy.length,
      calibration_tier_calibration_pre_cap_count: tierCal.length,
      calibration_tier_hard_pre_cap_count: tierHard.length,
      calibration_tier_easy_queue_count: easy.length,
      calibration_tier_calibration_queue_count: calibration.length,
      calibration_tier_hard_queue_count: hard.length,
    },
  };
}

/** @deprecated Use loadCalibrationTierQueuesWithDiagnostics — concatenates all tiers for old callers. */
export function loadAlbumReviewQueueWithDiagnostics(): {
  queue: ReviewRow[];
  pipeline: AlbumReviewPipelineDiagnostics;
} {
  const { queues, pipeline } = loadCalibrationTierQueuesWithDiagnostics();
  return {
    queue: [...queues.easy, ...queues.calibration, ...queues.hard],
    pipeline,
  };
}

/** @deprecated Prefer loadCalibrationTierQueuesWithDiagnostics. */
export function loadAlbumReviewQueue(): ReviewRow[] {
  return loadAlbumReviewQueueWithDiagnostics().queue;
}
