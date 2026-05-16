#!/usr/bin/env node
/**
 * Copy bundled album dossiers into public/ for Vercel.
 * Source: $RETROVERSE_DATA_ROOT/runtime/album-dossiers.json
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = (process.env.RETROVERSE_DATA_ROOT || "/Users/bobhopp/RETROVERSE_DATA").trim();
const src = path.join(root, "runtime", "album-dossiers.json");
const destDir = path.join(process.cwd(), "public", "data", "albums");
const dest = path.join(destDir, "album-dossiers.json");

if (!existsSync(src)) {
  console.error(`[publish-album-dossiers] Missing ${src}`);
  console.error("Run: npm run dossiers:materialize");
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[publish-album-dossiers] ${src} → ${dest}`);
