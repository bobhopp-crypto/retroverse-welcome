/**
 * Ordered restoration: Billboard 200 SQLite import → scoped iTunes artwork fill.
 * Run from repo root: `npm run billboard200:pipeline`
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

process.chdir(ROOT);
execSync("npx tsx scripts/import_billboard200_albums.ts", { stdio: "inherit", env: process.env });
execSync("npx tsx scripts/run_itunes_artwork_fill.ts", {
  stdio: "inherit",
  env: { ...process.env, ITUNES_FILL_SCOPE: process.env.ITUNES_FILL_SCOPE ?? "billboard200" },
});
