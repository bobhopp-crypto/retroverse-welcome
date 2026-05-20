#!/usr/bin/env node
/**
 * Copy bundled album dossiers + MusicBrainz sidecar into public/ for Vercel.
 * Source: $RETROVERSE_DATA_ROOT/runtime/
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const root = (process.env.RETROVERSE_DATA_ROOT || "/Users/bobhopp/RETROVERSE_DATA").trim();
const destDir = path.join(process.cwd(), "public", "data", "albums");

const copies = [
  {
    src: path.join(root, "runtime", "album-dossiers.json"),
    dest: path.join(destDir, "album-dossiers.json"),
    label: "album-dossiers",
    required: true,
  },
  {
    src: path.join(root, "runtime", "dossier-musicbrainz-by-rval.json"),
    dest: path.join(destDir, "dossier-musicbrainz-by-rval.json"),
    label: "dossier-musicbrainz-by-rval",
    required: false,
  },
];

mkdirSync(destDir, { recursive: true });

for (const { src, dest, label, required } of copies) {
  if (!existsSync(src)) {
    if (required) {
      console.error(`[publish-album-dossiers] Missing ${src}`);
      console.error("Run: npm run dossiers:materialize");
      process.exit(1);
    }
    console.warn(`[publish-album-dossiers] Skip optional ${label} (missing ${src})`);
    continue;
  }
  copyFileSync(src, dest);
  console.log(`[publish-album-dossiers] ${src} → ${dest}`);
}
