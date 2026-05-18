/**
 * Capture HTML pages to PNG (uses drive index when present).
 *
 * Usage: npm run sites:capture-html
 *
 * Env:
 *   SITES_CAPTURE_LIMIT=500
 *   SITES_CAPTURE_MISSING_ONLY=1   (default — skip pages that already have a preview)
 *   SITES_CAPTURE_FORCE=1        (recapture even when preview exists)
 *   SITES_CAPTURE_PROJECT=Retroverse
 *   SITES_CAPTURE_ID=<12-char id>  (single entry)
 *   SITES_CAPTURE_QUICK=1          (viewport only, no fullPage)
 */
import { existsSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { MAX_CAPTURE } from "../lib/retroverse-sites/constants";
import { capturePngAbsForId, captureCacheDir } from "../lib/retroverse-sites/index-store";
import { scanRetroverseSites } from "../lib/retroverse-sites/scan";

const LIMIT = Number(process.env.SITES_CAPTURE_LIMIT ?? "0") || MAX_CAPTURE;
const MISSING_ONLY =
  process.env.SITES_CAPTURE_FORCE !== "1" &&
  process.env.SITES_CAPTURE_MISSING_ONLY !== "0";
const PROJECT = process.env.SITES_CAPTURE_PROJECT?.trim();
const SINGLE_ID = process.env.SITES_CAPTURE_ID?.trim();
const QUICK = process.env.SITES_CAPTURE_QUICK === "1";
const VIEWPORT = { width: 1280, height: 900 };

async function main() {
  let chromium: typeof import("playwright").chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error("Missing playwright. Run: npx playwright install chromium");
    process.exit(1);
  }

  const scan = await scanRetroverseSites();
  let targets = scan.pages.filter((p) => p.htmlRelPath);

  if (SINGLE_ID) {
    targets = targets.filter((p) => p.id === SINGLE_ID);
  } else if (PROJECT) {
    targets = targets.filter((p) => p.folderGroup.toLowerCase() === PROJECT.toLowerCase());
  }

  if (MISSING_ONLY && !SINGLE_ID && process.env.SITES_CAPTURE_FORCE !== "1") {
    targets = targets.filter((p) => !p.hasPng);
  }

  targets = targets.slice(0, LIMIT);

  if (targets.length === 0) {
    console.log("Nothing to capture. Build index: npm run sites:index");
    return;
  }

  await mkdir(captureCacheDir(), { recursive: true });
  console.log(
    `Capturing ${targets.length} HTML → ${captureCacheDir()}${MISSING_ONLY ? " (missing only)" : ""}${PROJECT ? ` project=${PROJECT}` : ""}`,
  );

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT });

  let ok = 0;
  let fail = 0;

  for (const entry of targets) {
    if (!entry.htmlRelPath) continue;
    const htmlAbs = entry.htmlRelPath;
    const pngAbs = capturePngAbsForId(entry.id);
    if (process.env.SITES_CAPTURE_FORCE === "1" && existsSync(pngAbs)) {
      try {
        unlinkSync(pngAbs);
      } catch {
        /* ignore */
      }
    }
    const fileUrl = `file://${htmlAbs}`;
    process.stdout.write(`${path.basename(htmlAbs)} … `);
    try {
      await page.goto(fileUrl, { waitUntil: "load", timeout: QUICK ? 12_000 : 20_000 });
      await page.waitForTimeout(QUICK ? 150 : 400);
      await page.screenshot({
        path: pngAbs,
        type: "png",
        fullPage: !QUICK,
      });
      console.log("ok");
      ok += 1;
    } catch (err) {
      console.log("fail", err instanceof Error ? err.message : err);
      fail += 1;
    }
  }

  await browser.close();
  console.log(`Done. ${ok} saved, ${fail} failed. Refresh browser to see new previews.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
