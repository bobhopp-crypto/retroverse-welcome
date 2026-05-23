/**
 * Weekly-safe VirtualDJ refresh: reparse database.xml and upsert instances + cues.
 *
 * Usage:
 *   npm run vdj:refresh
 *   VDJ_DATABASE_XML=/path/to/database.xml npm run vdj:refresh
 *
 * Cron example (Sunday 03:00):
 *   0 3 * * 0 cd /path/to/retroverse-welcome && npm run vdj:refresh >> logs/vdj-refresh.log 2>&1
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const WORKSPACE = resolve(__dirname, "..");

function main(): void {
  const ingest = spawnSync("npx", ["tsx", "scripts/ingest_vdj_track_instances.ts"], {
    cwd: WORKSPACE,
    encoding: "utf8",
    stdio: "inherit",
    env: { ...process.env, VDJ_SKIP_PARSE: "0" },
  });
  if (ingest.status !== 0) {
    process.exit(ingest.status ?? 1);
  }
}

main();
