import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import type { CalibrationRetryStrategyId } from "@/app/ops/review/load-review-data";
import { runItunesFillOnce } from "@/app/ops/itunes-album-review/run-itunes-fill-once";

const LOG_DIR = path.join(process.cwd(), "data", "diagnostics", "itunes");
const RETRY_LOG = path.join(LOG_DIR, "calibration_retries.jsonl");

type Body = {
  billboardArtist?: string;
  billboardAlbum?: string;
  manualQuery?: string;
  strategy?: CalibrationRetryStrategyId;
};

export async function POST(req: Request) {
  if (process.env.ITUNES_REVIEW_RERUN_ENABLED !== "1") {
    return NextResponse.json(
      {
        error:
          "Rerun disabled. Set ITUNES_REVIEW_RERUN_ENABLED=1 and ensure SUPABASE_* credentials are available to the dev server.",
      },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const artist = (body.billboardArtist ?? "").trim();
  const album = (body.billboardAlbum ?? "").trim();
  const manualQuery = (body.manualQuery ?? "").trim();
  const strategy = body.strategy;

  if (!artist || !album) {
    return NextResponse.json({ error: "billboardArtist and billboardAlbum required" }, { status: 400 });
  }

  const validStrategies: CalibrationRetryStrategyId[] = [
    "artist_only",
    "artist_album",
    "broad_search",
    "loose_match",
    "title_only",
    "ignore_year",
  ];
  if (!manualQuery && strategy && !validStrategies.includes(strategy)) {
    return NextResponse.json({ error: "invalid strategy" }, { status: 400 });
  }

  let strategyLogged: string;
  if (manualQuery) {
    strategyLogged = "manual_override";
  } else if (strategy) {
    strategyLogged = strategy;
  } else {
    return NextResponse.json({ error: "strategy or manualQuery required" }, { status: 400 });
  }

  await mkdir(LOG_DIR, { recursive: true });

  const run = manualQuery
    ? await runItunesFillOnce({ billboardArtist: artist, billboardAlbum: album, manualQuery })
    : await runItunesFillOnce({ billboardArtist: artist, billboardAlbum: album, strategy: strategy! });

  if (run.ok) {
    await appendFile(
      RETRY_LOG,
      JSON.stringify({
        ts: new Date().toISOString(),
        kind: "calibration_retry",
        strategy: strategyLogged,
        billboardArtist: artist,
        billboardAlbum: album,
        ok: true,
      }) + "\n",
      "utf8",
    );
    return NextResponse.json({ ok: true, strategy: strategyLogged, log: run.logText });
  }

  const failed = run as { ok: false; logText: string; error: string };
  await appendFile(
    RETRY_LOG,
    JSON.stringify({
      ts: new Date().toISOString(),
      kind: "calibration_retry",
      strategy: strategyLogged,
      billboardArtist: artist,
      billboardAlbum: album,
      ok: false,
      error: failed.error,
    }) + "\n",
    "utf8",
  );
  return NextResponse.json(
    {
      ok: false,
      strategy: strategyLogged,
      error: failed.error,
      log: failed.logText,
    },
    { status: 500 },
  );
}
