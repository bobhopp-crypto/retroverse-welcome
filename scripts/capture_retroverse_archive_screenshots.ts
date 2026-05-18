/**
 * Capture PNG thumbnails for Retroverse Archive (routable pages + static HTML).
 *
 * Prereq: dev server running — npm run dev
 * Usage:  npm run archive:capture-screenshots
 * Env:    ARCHIVE_CAPTURE_BASE_URL=http://localhost:3000
 *         ARCHIVE_CAPTURE_LIMIT=40   (optional cap)
 */
import { mkdir } from "node:fs/promises";

import { scanRetroverseArchive } from "../lib/retroverse-archive/scan";
import {
  captureUrlForArtifact,
  screenshotAbsForId,
  screenshotDirAbs,
} from "../lib/retroverse-archive/screenshots";

const BASE = process.env.ARCHIVE_CAPTURE_BASE_URL?.trim() || "http://localhost:3000";
const LIMIT = Number(process.env.ARCHIVE_CAPTURE_LIMIT ?? "0") || Infinity;
const VIEWPORT = { width: 1280, height: 800 };

async function main() {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Missing playwright. Run: npm install -D playwright && npx playwright install chromium");
    process.exit(1);
  }

  const scan = await scanRetroverseArchive();
  const targets = scan.all.filter((a) => {
    if (a.kind === "html-static" && a.rawHref) return true;
    if (a.routableHere && a.launchHref) return true;
    return false;
  }).filter((a) => !!captureUrlForArtifact(a, BASE));

  const slice = targets.slice(0, LIMIT);
  await mkdir(screenshotDirAbs(), { recursive: true });

  console.log(`Capturing ${slice.length} pages from ${BASE} → ${screenshotDirAbs()}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });

  let ok = 0;
  let fail = 0;

  for (const artifact of slice) {
    const url = captureUrlForArtifact(artifact, BASE);
    if (!url) continue;
    const out = screenshotAbsForId(artifact.id);
    process.stdout.write(`${artifact.label} … `);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 25_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: out, type: "png", fullPage: false });
      console.log("ok");
      ok += 1;
    } catch (err) {
      console.log("fail", err instanceof Error ? err.message : err);
      fail += 1;
    }
  }

  await browser.close();
  console.log(`Done. ${ok} saved, ${fail} failed. Reload /retroverse-archive to see thumbnails.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
