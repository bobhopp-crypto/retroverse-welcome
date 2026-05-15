#!/usr/bin/env node
/**
 * Copy materialized RetroScope runtime JSON into public/ for Vercel deployment.
 *
 * Source: $RETROVERSE_DATA_ROOT/runtime/ (default: /Users/bobhopp/RETROVERSE_DATA on Bob's machine)
 * Dest:   public/data/retroscope/
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = (process.env.RETROVERSE_DATA_ROOT || "/Users/bobhopp/RETROVERSE_DATA").trim();
const runtimeDir = path.join(root, "runtime");
const outDir = path.join(process.cwd(), "public", "data", "retroscope");

const pairs = [
  ["retroscope-coordinates.json", "retroscope-coordinates.json"],
  ["retroscope-universe.json", "retroscope-universe.json"],
];

mkdirSync(outDir, { recursive: true });

let ok = 0;
for (const [name, destName] of pairs) {
  const src = path.join(runtimeDir, name);
  const dest = path.join(outDir, destName);
  if (!existsSync(src)) {
    console.error(`[publish-retroscope-runtime] Missing source: ${src}`);
    console.error("Run: npm run retroscope:runtime (after materializing DB)");
    process.exit(1);
  }
  copyFileSync(src, dest);
  console.log(`[publish-retroscope-runtime] ${src} → ${dest}`);
  ok++;
}

console.log(`[publish-retroscope-runtime] OK (${ok} files)`);
