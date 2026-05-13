/**
 * Persistent calibration queue state (separate from attempts/candidates CSVs).
 */

import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CalibrationRetryStrategyId } from "@/app/ops/review/load-review-data";

const LOG_DIR = path.join(process.cwd(), "data", "diagnostics", "itunes");
export const CALIBRATION_STATE_FILE = path.join(LOG_DIR, "calibration_row_state.json");
export const CALIBRATION_LEARNING_LOG = path.join(LOG_DIR, "calibration_learning.jsonl");

export type CalibrationQueueState =
  | "NEW"
  | "AUTO_VERIFIED"
  | "HUMAN_VERIFIED"
  | "RETRY_PENDING"
  | "EXHAUSTED"
  | "DISCOGS_REVIEW"
  | "MANUAL_RESOLVED"
  | "SKIPPED";

export type CalibrationHumanVerified = {
  artist: string;
  album: string;
  collectionId: string;
  focusSlot: number;
};

export type CalibrationDiscogsRecovery = {
  url: string;
  extracted: unknown;
  savedAt: string;
};

export type CalibrationStoredRow = {
  state: CalibrationQueueState;
  /**
   * Number of finite escalation runs already completed (0..4).
   * Next TRY AGAIN runs ESCALATION_STRATEGIES[escalationStage] if escalationStage < 4.
   */
  escalationStage: number;
  updatedAt: string;
  humanVerified?: CalibrationHumanVerified;
  discogs?: CalibrationDiscogsRecovery;
};

export type CalibrationStateFile = {
  version: 1;
  rows: Record<string, CalibrationStoredRow>;
};

export const ESCALATION_STRATEGIES: readonly CalibrationRetryStrategyId[] = [
  "artist_only",
  "artist_album",
  "broad_search",
  "ignore_year",
] as const;

export function billboardStateKey(billboardArtist: string, billboardAlbum: string): string {
  return `${billboardArtist.trim()}\n${billboardAlbum.trim()}`;
}

export function defaultRowState(): CalibrationStoredRow {
  return {
    state: "NEW",
    escalationStage: 0,
    updatedAt: new Date().toISOString(),
  };
}

async function ensureLogDir(): Promise<void> {
  await mkdir(LOG_DIR, { recursive: true });
}

/** Sync read for Next.js loaders (no async page required). */
export function loadCalibrationStateMapSync(): Record<string, CalibrationStoredRow> {
  if (!existsSync(CALIBRATION_STATE_FILE)) return {};
  try {
    const raw = readFileSync(CALIBRATION_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as CalibrationStateFile;
    if (!parsed || parsed.version !== 1 || typeof parsed.rows !== "object" || !parsed.rows) return {};
    return parsed.rows;
  } catch {
    return {};
  }
}

export async function loadCalibrationStateFile(): Promise<CalibrationStateFile> {
  try {
    const raw = await readFile(CALIBRATION_STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as CalibrationStateFile;
    if (!parsed || parsed.version !== 1 || typeof parsed.rows !== "object" || !parsed.rows) {
      return { version: 1, rows: {} };
    }
    return parsed;
  } catch {
    return { version: 1, rows: {} };
  }
}

export async function getRowState(
  billboardArtist: string,
  billboardAlbum: string,
): Promise<CalibrationStoredRow> {
  const f = await loadCalibrationStateFile();
  const k = billboardStateKey(billboardArtist, billboardAlbum);
  return f.rows[k] ?? defaultRowState();
}

export async function upsertRowState(
  billboardArtist: string,
  billboardAlbum: string,
  patch: Partial<CalibrationStoredRow>,
): Promise<CalibrationStoredRow> {
  await ensureLogDir();
  const file = await loadCalibrationStateFile();
  const k = billboardStateKey(billboardArtist, billboardAlbum);
  const prev = file.rows[k] ?? defaultRowState();
  const next: CalibrationStoredRow = {
    ...prev,
    ...patch,
    state: patch.state ?? prev.state,
    escalationStage: patch.escalationStage ?? prev.escalationStage,
    updatedAt: new Date().toISOString(),
  };
  file.rows[k] = next;
  const tmp = `${CALIBRATION_STATE_FILE}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, CALIBRATION_STATE_FILE);
  return next;
}

/** Rows that leave the actionable calibration queues. */
export function isCalibrationRowComplete(st: CalibrationStoredRow | undefined): boolean {
  if (!st) return false;
  return st.state === "HUMAN_VERIFIED" || st.state === "MANUAL_RESOLVED" || st.state === "AUTO_VERIFIED";
}

export function shouldForceHardTierForDiscogs(st: CalibrationStoredRow | undefined): boolean {
  if (!st) return false;
  return st.state === "DISCOGS_REVIEW" || st.state === "EXHAUSTED";
}

export type CalibrationLearningEvent = {
  ts: string;
  kind: "use_this" | "try_again" | "skip" | "discogs_save" | "escalation_exhausted";
  billboardArtist: string;
  billboardAlbum: string;
  chartYear: number | null;
  workflowTier: "easy" | "calibration" | "hard";
  /** Escalation stage after this event (0–4 while in finite retries). */
  retryStage: number;
  strategyUsed: string | null;
  matchScore: number | null;
  artistSimilarity: number | null;
  albumSimilarity: number | null;
  tokenOverlap: number | null;
  yearDistance: number | null;
  alternateSelected: boolean;
  pipelineRejectionReason: string;
  reviewBucket: string;
  queueStateAfter: CalibrationQueueState;
  rerunOk?: boolean;
  notes?: string;
};

export async function appendCalibrationLearning(event: CalibrationLearningEvent): Promise<void> {
  await ensureLogDir();
  await appendFile(CALIBRATION_LEARNING_LOG, JSON.stringify(event) + "\n", "utf8");
}
