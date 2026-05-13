import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { CalibrationRetryStrategyId } from "@/app/ops/review/load-review-data";

const execFileAsync = promisify(execFile);

export async function runItunesFillOnce(args: {
  billboardArtist: string;
  billboardAlbum: string;
  strategy?: CalibrationRetryStrategyId;
  manualQuery?: string;
}): Promise<{ ok: true; logText: string } | { ok: false; logText: string; error: string }> {
  const force = `${args.billboardArtist}\t${args.billboardAlbum}`;
  const env: Record<string, string | undefined> = {
    ...process.env,
    ITUNES_FILL_LIMIT: "1",
    ITUNES_FILL_FORCE_REVIEW: force,
  };
  delete env.ITUNES_FILL_CALIBRATION_STRATEGY;
  delete env.ITUNES_FILL_OVERRIDE_QUERY;

  if (args.manualQuery?.trim()) {
    env.ITUNES_FILL_OVERRIDE_QUERY = args.manualQuery.trim();
  } else if (args.strategy) {
    env.ITUNES_FILL_CALIBRATION_STRATEGY = args.strategy;
  } else {
    return { ok: false, logText: "", error: "strategy or manualQuery required" };
  }

  try {
    const { stdout, stderr } = await execFileAsync("npx", ["tsx", "scripts/run_itunes_artwork_fill.ts"], {
      cwd: process.cwd(),
      env: env as NodeJS.ProcessEnv,
      maxBuffer: 24 * 1024 * 1024,
      timeout: 180_000,
    });
    const logText = [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n---\n");
    return { ok: true, logText };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    const logText = [err.stdout?.trim(), err.stderr?.trim()].filter(Boolean).join("\n---\n");
    return { ok: false, logText, error: err.message ?? "run failed" };
  }
}
