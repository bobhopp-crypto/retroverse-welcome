/**
 * Build personal Sites archaeology index (HTML + preview images).
 *
 * Usage:  npm run sites:index
 * Dry run: SITES_INDEX_DRY_RUN=1 npm run sites:index
 * Quick:   SITES_INDEX_QUICK=1 npm run sites:index
 *
 * Env:    SITES_PROJECTS_ROOT=~/Sites
 *         SITES_INDEX_MAX_HTML=8000
 *         SITES_INDEX_MAX_IMAGES=3000
 *         SITES_INDEX_PROJECT=Retroverse  (limit to one top-level folder)
 */
import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { MAX_INDEX_HTML, MAX_INDEX_IMAGES } from "../lib/retroverse-sites/constants";
import {
  capturePngAbsForId,
  driveIndexPath,
  type ProjectSummary,
  type RootSummary,
  type SitesDriveIndex,
} from "../lib/retroverse-sites/index-store";
import { museumHintsForPath, projectGroupFor, siblingPreviewPath } from "../lib/retroverse-sites/filter";
import { fileLaunchHref, imageApiHref, pageId } from "../lib/retroverse-sites/paths";
import { resolveDriveScanRoots, resolveSitesProjectsRoot } from "../lib/retroverse-sites/roots";
import type { SitePageEntry } from "../lib/retroverse-sites/scan";
import { walkSitesProjects } from "../lib/retroverse-sites/walk";

const DRY_RUN = process.env.SITES_INDEX_DRY_RUN === "1" || process.env.SITES_INDEX_DRY_RUN === "true";
const QUICK = process.env.SITES_INDEX_QUICK === "1" || process.env.SITES_INDEX_QUICK === "true";
const PROJECT_FILTER = process.env.SITES_INDEX_PROJECT?.trim();

function htmlLimits() {
  const html = QUICK ? Math.min(2000, MAX_INDEX_HTML) : MAX_INDEX_HTML;
  const images = QUICK ? Math.min(800, MAX_INDEX_IMAGES) : MAX_INDEX_IMAGES;
  return { html, images };
}

async function main() {
  const scanRoots = resolveDriveScanRoots();
  const sitesRoot = scanRoots[0] ?? resolveSitesProjectsRoot();
  const htmlAbs: string[] = [];
  const imageAbs: string[] = [];
  const t0 = Date.now();
  const limits = htmlLimits();

  console.log("Sites project archaeology index");
  console.log("Root:", sitesRoot);
  if (PROJECT_FILTER) console.log("Project filter:", PROJECT_FILTER);
  if (QUICK) console.log("Quick mode — reduced limits");
  if (DRY_RUN) console.log("(dry run — no file written)\n");

  const walk = await walkSitesProjects(
    sitesRoot,
    (hit) => {
      if (hit.kind === "html") htmlAbs.push(hit.absPath);
      else imageAbs.push(hit.absPath);
    },
    limits,
    { projectFilter: PROJECT_FILTER },
  );

  const rootSummaries: RootSummary[] = [
    {
      root: sitesRoot,
      html: walk.html,
      png: walk.images,
      entries: 0,
    },
  ];

  const byId = new Map<string, SitePageEntry>();

  for (const abs of imageAbs) {
    const id = pageId(abs);
    const st = await stat(abs).catch(() => null);
    const norm = abs.replace(/\\/g, "/");
    const isRoute = /site_report\/screenshots\//i.test(norm);
    byId.set(id, {
      id,
      label: path.basename(abs).replace(/\.(png|jpe?g|webp|gif)$/i, ""),
      absPath: abs,
      folderGroup: projectGroupFor(abs, sitesRoot),
      htmlRelPath: null,
      pngRelPath: abs,
      hasPng: true,
      modifiedAt: st?.mtime.toISOString() ?? new Date().toISOString(),
      imageHref: imageApiHref(id),
      launchHref: fileLaunchHref(abs),
      source: isRoute ? "route-capture" : "image",
      hints: museumHintsForPath(abs, "image"),
    });
  }

  for (const abs of htmlAbs) {
    const id = pageId(abs);
    const captureAbs = capturePngAbsForId(id);
    const sibling = siblingPreviewPath(abs);
    const preview =
      (existsSync(captureAbs) && captureAbs) || sibling || null;
    const hasPreview = !!preview;
    const st = await stat(hasPreview && preview ? preview : abs).catch(() => null);
    const existing = byId.get(id);
    if (existing?.hasPng && !abs.endsWith(".html")) continue;

    byId.set(id, {
      id,
      label: abs.replace(/\.html?$/i, ""),
      absPath: abs,
      folderGroup: projectGroupFor(abs, sitesRoot),
      htmlRelPath: abs,
      pngRelPath: preview,
      hasPng: hasPreview,
      modifiedAt: st?.mtime.toISOString() ?? new Date().toISOString(),
      imageHref: hasPreview ? imageApiHref(id) : null,
      launchHref: fileLaunchHref(abs),
      source: "html",
      hints: museumHintsForPath(abs, "html"),
    });
  }

  const entries = [...byId.values()].sort((a, b) => {
    const g = a.folderGroup.localeCompare(b.folderGroup);
    if (g !== 0) return g;
    return b.modifiedAt.localeCompare(a.modifiedAt);
  });
  const withPng = entries.filter((e) => e.hasPng).length;

  rootSummaries[0]!.entries = entries.length;

  const projectSummaries: ProjectSummary[] = [...walk.byProject.entries()]
    .map(([project, c]) => ({
      project,
      html: c.html,
      images: c.images,
      entries: entries.filter((e) => e.folderGroup === project).length,
    }))
    .sort((a, b) => b.entries - a.entries);

  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nDone in ${sec}s`);
  console.log(
    `HTML matched: ${walk.html} · skipped (filter): ${walk.skippedHtml} · images: ${walk.images}`,
  );
  console.log(`Entries: ${entries.length} · with preview: ${withPng}\n`);
  console.log("Projects:");
  for (const ps of projectSummaries.slice(0, 25)) {
    console.log(`  ${ps.entries}\t${ps.project} (html=${ps.html} img=${ps.images})`);
  }
  if (projectSummaries.length > 25) {
    console.log(`  … +${projectSummaries.length - 25} more`);
  }

  if (DRY_RUN) return;

  const index: SitesDriveIndex = {
    builtAt: new Date().toISOString(),
    scanRoots,
    entryCount: entries.length,
    withPng,
    skippedHtml: walk.skippedHtml,
    rootSummaries,
    projectSummaries,
    entries,
  };

  const out = driveIndexPath();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(index));
  console.log(`\nWrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
