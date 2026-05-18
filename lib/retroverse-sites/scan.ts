import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  capturePngAbsForId,
  driveIndexPath,
  loadDriveIndex,
  type ProjectSummary,
  type RootSummary,
} from "./index-store";
import type { MuseumHints } from "./filter";
import { museumHintsForPath, projectGroupFor, siblingPreviewPath } from "./filter";
import { MAX_INDEX_HTML, MAX_INDEX_IMAGES } from "./constants";
import { walkSitesProjects } from "./walk";
import { fileLaunchHref, imageApiHref, pageId } from "./paths";
import {
  defaultDriveScanRootsLabel,
  resolveDriveScanRoots,
  resolveSitesProjectsRoot,
} from "./roots";

export type SitePageSource = "html" | "image" | "route-capture" | "png";

export type SitePageEntry = {
  id: string;
  label: string;
  absPath: string;
  folderGroup: string;
  htmlRelPath: string | null;
  pngRelPath: string | null;
  hasPng: boolean;
  modifiedAt: string;
  imageHref: string | null;
  launchHref: string;
  source: SitePageSource;
  /** Optional path hints — never used to exclude from index. */
  hints?: MuseumHints;
};

export type SitesScanResult = {
  scannedAt: string;
  sitesRoot: string;
  scanRoots: string[];
  indexPath: string | null;
  usingDriveIndex: boolean;
  pageCount: number;
  withPng: number;
  rootSummaries: RootSummary[];
  projectSummaries: ProjectSummary[];
  pages: SitePageEntry[];
};

function labelFromAbs(absPath: string): string {
  const base = path.basename(absPath);
  if (/\.html?$/i.test(base)) return absPath.replace(/\.html?$/i, "");
  return base.replace(/\.(png|jpe?g|webp|gif)$/i, "");
}

function previewForHtml(absPath: string, id: string): { preview: string | null; hasPreview: boolean } {
  const captureAbs = capturePngAbsForId(id);
  if (existsSync(captureAbs)) return { preview: captureAbs, hasPreview: true };
  const sibling = siblingPreviewPath(absPath);
  if (sibling) return { preview: sibling, hasPreview: true };
  return { preview: null, hasPreview: false };
}

function enrichEntry(e: SitePageEntry, sitesRoot: string): SitePageEntry {
  const folderGroup = e.folderGroup || projectGroupFor(e.absPath, sitesRoot);
  const launchHref = e.launchHref || fileLaunchHref(e.htmlRelPath ?? e.absPath);

  if (e.htmlRelPath) {
    const { preview, hasPreview } = previewForHtml(e.htmlRelPath, e.id);
    if (hasPreview && preview) {
      return {
        ...e,
        folderGroup,
        launchHref,
        hasPng: true,
        pngRelPath: preview,
        imageHref: imageApiHref(e.id),
      };
    }
    const captureAbs = capturePngAbsForId(e.id);
    if (existsSync(captureAbs)) {
      return {
        ...e,
        folderGroup,
        launchHref,
        hasPng: true,
        pngRelPath: captureAbs,
        imageHref: imageApiHref(e.id),
      };
    }
    return { ...e, folderGroup, launchHref, hasPng: false, pngRelPath: null, imageHref: null };
  }

  const isImage = e.source === "image" || e.source === "png" || e.source === "route-capture";
  if (isImage && existsSync(e.absPath)) {
    return {
      ...e,
      folderGroup,
      launchHref,
      hasPng: true,
      pngRelPath: e.absPath,
      imageHref: imageApiHref(e.id),
    };
  }

  return { ...e, folderGroup, launchHref };
}

function projectSummariesFromPages(pages: SitePageEntry[]): ProjectSummary[] {
  const map = new Map<string, { html: number; images: number; entries: number }>();
  for (const p of pages) {
    const row = map.get(p.folderGroup) ?? { html: 0, images: 0, entries: 0 };
    row.entries += 1;
    if (p.source === "html") row.html += 1;
    else row.images += 1;
    map.set(p.folderGroup, row);
  }
  return [...map.entries()]
    .map(([project, c]) => ({ project, ...c }))
    .sort((a, b) => b.entries - a.entries);
}

export async function scanRetroverseSites(): Promise<SitesScanResult> {
  const driveIndex = loadDriveIndex();
  const scanRoots = driveIndex?.scanRoots ?? resolveDriveScanRoots();
  const sitesRoot = scanRoots[0] ?? resolveSitesProjectsRoot();
  const rootsLabel = defaultDriveScanRootsLabel(scanRoots);

  if (driveIndex) {
    const pages = driveIndex.entries.map((e) => enrichEntry(e, sitesRoot));
    return {
      scannedAt: driveIndex.builtAt,
      sitesRoot: rootsLabel,
      scanRoots,
      indexPath: driveIndexPath(),
      usingDriveIndex: true,
      pageCount: pages.length,
      withPng: pages.filter((p) => p.hasPng).length,
      rootSummaries: driveIndex.rootSummaries ?? [],
      projectSummaries: driveIndex.projectSummaries ?? projectSummariesFromPages(pages),
      pages,
    };
  }

  return scanLegacySitesFallback(rootsLabel, scanRoots, sitesRoot);
}

async function scanLegacySitesFallback(
  rootsLabel: string,
  scanRoots: string[],
  sitesRoot: string,
): Promise<SitesScanResult> {
  if (!existsSync(sitesRoot)) {
    return {
      scannedAt: new Date().toISOString(),
      sitesRoot: rootsLabel,
      scanRoots,
      indexPath: null,
      usingDriveIndex: false,
      pageCount: 0,
      withPng: 0,
      rootSummaries: [],
      projectSummaries: [],
      pages: [],
    };
  }

  const pages: SitePageEntry[] = [];
  const byId = new Map<string, SitePageEntry>();

  await walkSitesProjects(sitesRoot, async (hit) => {
    if (hit.kind === "html") {
      const abs = hit.absPath;
      const id = pageId(abs);
      const { preview, hasPreview } = previewForHtml(abs, id);
      const st = await stat(hasPreview && preview ? preview : abs).catch(() => null);
      byId.set(id, {
        id,
        label: labelFromAbs(abs),
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
    } else {
      const abs = hit.absPath;
      const id = pageId(abs);
      const st = await stat(abs).catch(() => null);
      const isRoute = /site_report\/screenshots\//i.test(abs.replace(/\\/g, "/"));
      if (byId.has(id)) return;
      byId.set(id, {
        id,
        label: labelFromAbs(abs),
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
  }, { html: MAX_INDEX_HTML, images: MAX_INDEX_IMAGES });

  pages.push(...byId.values());

  const sorted = pages.sort((a, b) => {
    if (a.hasPng !== b.hasPng) return a.hasPng ? -1 : 1;
    return b.modifiedAt.localeCompare(a.modifiedAt);
  });

  return {
    scannedAt: new Date().toISOString(),
    sitesRoot: rootsLabel,
    scanRoots,
    indexPath: null,
    usingDriveIndex: false,
    pageCount: sorted.length,
    withPng: sorted.filter((p) => p.hasPng).length,
    rootSummaries: [{ root: sitesRoot, html: sorted.length, png: 0, entries: sorted.length }],
    projectSummaries: projectSummariesFromPages(sorted),
    pages: sorted,
  };
}
