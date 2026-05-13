import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  appendCalibrationLearning,
  ESCALATION_STRATEGIES,
  getRowState,
  upsertRowState,
  type CalibrationLearningEvent,
  type CalibrationQueueState,
} from "@/app/ops/itunes-album-review/calibration-state";
import { runItunesFillOnce } from "@/app/ops/itunes-album-review/run-itunes-fill-once";

const LOG_DIR = path.join(process.cwd(), "data", "diagnostics", "itunes");
const RETRY_LOG = path.join(LOG_DIR, "calibration_retries.jsonl");

type WorkflowTier = "easy" | "calibration" | "hard";

type Body = {
  action?: "use_this" | "try_again" | "skip";
  billboardArtist?: string;
  billboardAlbum?: string;
  chartYear?: number;
  workflowTier?: WorkflowTier;
  selectedArtist?: string;
  selectedAlbum?: string;
  matchedCollectionId?: string;
  focusSlot?: number;
  matchScore?: number | null;
  artistSimilarity?: number | null;
  albumSimilarity?: number | null;
  tokenOverlap?: number | null;
  yearDistance?: number | null;
  alternateSelected?: boolean;
  pipelineRejectionReason?: string;
  reviewBucket?: string;
};

function tierOrDefault(t: string | undefined): WorkflowTier {
  if (t === "easy" || t === "calibration" || t === "hard") return t;
  return "easy";
}

function buildLearning(
  body: Body,
  artist: string,
  album: string,
  workflowTier: WorkflowTier,
  kind: CalibrationLearningEvent["kind"],
  fields: {
    retryStage: number;
    strategyUsed: string | null;
    queueStateAfter: CalibrationQueueState;
    rerunOk?: boolean;
    notes?: string;
  },
): CalibrationLearningEvent {
  const poolIdx = body.focusSlot ?? -1;
  return {
    ts: new Date().toISOString(),
    kind,
    billboardArtist: artist,
    billboardAlbum: album,
    chartYear: body.chartYear ?? null,
    workflowTier,
    retryStage: fields.retryStage,
    strategyUsed: fields.strategyUsed,
    matchScore: body.matchScore ?? null,
    artistSimilarity: body.artistSimilarity ?? null,
    albumSimilarity: body.albumSimilarity ?? null,
    tokenOverlap: body.tokenOverlap ?? null,
    yearDistance: body.yearDistance ?? null,
    alternateSelected: Boolean(body.alternateSelected ?? poolIdx >= 0),
    pipelineRejectionReason: body.pipelineRejectionReason ?? "",
    reviewBucket: body.reviewBucket ?? "",
    queueStateAfter: fields.queueStateAfter,
    rerunOk: fields.rerunOk,
    notes: fields.notes,
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const action = body.action;
  if (action !== "use_this" && action !== "try_again" && action !== "skip") {
    return NextResponse.json({ error: "action must be use_this, try_again, or skip" }, { status: 400 });
  }

  const artist = (body.billboardArtist ?? "").trim();
  const album = (body.billboardAlbum ?? "").trim();
  if (!artist || !album) {
    return NextResponse.json({ error: "billboardArtist and billboardAlbum required" }, { status: 400 });
  }

  const workflowTier = tierOrDefault(body.workflowTier);
  const prior = await getRowState(artist, album);

  if (action === "skip") {
    await appendCalibrationLearning(
      buildLearning(body, artist, album, workflowTier, "skip", {
        retryStage: prior.escalationStage,
        strategyUsed: null,
        queueStateAfter: prior.state,
      }),
    );
    return NextResponse.json({ ok: true, action: "skip", state: prior.state, escalationStage: prior.escalationStage });
  }

  if (action === "use_this") {
    const poolIdx = body.focusSlot ?? -1;
    const selArtist = (body.selectedArtist ?? "").trim() || artist;
    const selAlbum = (body.selectedAlbum ?? "").trim() || album;
    const collectionId = (body.matchedCollectionId ?? "").trim();
    const next = await upsertRowState(artist, album, {
      state: "HUMAN_VERIFIED",
      humanVerified: {
        artist: selArtist,
        album: selAlbum,
        collectionId,
        focusSlot: poolIdx,
      },
    });
    await appendCalibrationLearning(
      buildLearning(body, artist, album, workflowTier, "use_this", {
        retryStage: next.escalationStage,
        strategyUsed: null,
        queueStateAfter: "HUMAN_VERIFIED",
      }),
    );
    return NextResponse.json({ ok: true, state: next.state, escalationStage: next.escalationStage });
  }

  // try_again
  if (prior.state === "DISCOGS_REVIEW") {
    return NextResponse.json(
      { error: "Row is in Discogs lane — save a Discogs URL or advance with NEXT." },
      { status: 400 },
    );
  }

  const escBefore = prior.escalationStage;

  if (escBefore >= ESCALATION_STRATEGIES.length) {
    const next = await upsertRowState(artist, album, { state: "DISCOGS_REVIEW" });
    await appendCalibrationLearning(
      buildLearning(body, artist, album, workflowTier, "escalation_exhausted", {
        retryStage: escBefore,
        strategyUsed: null,
        queueStateAfter: "DISCOGS_REVIEW",
        notes: "finite retries exhausted → discogs lane",
      }),
    );
    return NextResponse.json({
      ok: true,
      state: next.state,
      escalationStage: next.escalationStage,
      discogsLane: true,
      log: null,
    });
  }

  if (process.env.ITUNES_REVIEW_RERUN_ENABLED !== "1") {
    return NextResponse.json(
      {
        error:
          "Rerun disabled. Set ITUNES_REVIEW_RERUN_ENABLED=1 and ensure SUPABASE_* credentials are available to the dev server.",
      },
      { status: 403 },
    );
  }

  const strategy = ESCALATION_STRATEGIES[escBefore]!;
  await upsertRowState(artist, album, { state: "RETRY_PENDING" });

  const run = await runItunesFillOnce({ billboardArtist: artist, billboardAlbum: album, strategy });

  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(
    RETRY_LOG,
    JSON.stringify({
      ts: new Date().toISOString(),
      kind: "calibration_retry",
      strategy,
      billboardArtist: artist,
      billboardAlbum: album,
      ok: run.ok,
      escalationStageBefore: escBefore,
    }) + "\n",
    "utf8",
  );

  if (!run.ok) {
    await upsertRowState(artist, album, { state: "NEW" });
    await appendCalibrationLearning(
      buildLearning(body, artist, album, workflowTier, "try_again", {
        retryStage: escBefore,
        strategyUsed: strategy,
        queueStateAfter: "NEW",
        rerunOk: false,
        notes: run.error,
      }),
    );
    return NextResponse.json(
      {
        ok: false,
        state: "NEW",
        escalationStage: escBefore,
        strategy,
        error: run.error,
        log: run.logText,
      },
      { status: 500 },
    );
  }

  const nextStage = escBefore + 1;
  const next = await upsertRowState(artist, album, {
    state: "NEW",
    escalationStage: nextStage,
  });

  await appendCalibrationLearning(
    buildLearning(body, artist, album, workflowTier, "try_again", {
      retryStage: nextStage,
      strategyUsed: strategy,
      queueStateAfter: "NEW",
      rerunOk: true,
    }),
  );

  return NextResponse.json({
    ok: true,
    state: next.state,
    escalationStage: next.escalationStage,
    strategy,
    log: run.logText,
  });
}
