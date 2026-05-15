/**
 * One-shot occupancy validation (same data path as /retroverse_v3?occupancy=validate).
 * Run: npx tsx scripts/rv3_occupancy_validate.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnvLocal() {
  const p = join(process.cwd(), ".env.local");
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

async function main() {
  const { loadOccupancyBundleDirect } = await import("../app/retroverse_v3/load-occupancy");
  const bundle = await loadOccupancyBundleDirect(true);
  const keys = ["rumours", "dark_side", "thriller", "nevermind"] as const;
  const rows = keys.map((k) => bundle.calibration?.albums.find((a) => a.key === k));
  console.log(JSON.stringify({ load: bundle.loadReport, calibrationSubset: rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
