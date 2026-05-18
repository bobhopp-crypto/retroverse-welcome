import { existsSync, readFileSync, statSync } from "node:fs";

import { siblingPreviewPath } from "./filter";
import { capturePngAbsForId, driveIndexPath, loadDriveIndex, type SitesDriveIndex } from "./index-store";
import { fileLaunchHref, imageApiHref } from "./image-urls";
import type { SitePageEntry, SitesScanResult } from "./scan";

export type SitesGalleryMeta = Omit<SitesScanResult, "pages">;

export type EntriesQuery = {
  project?: string;
  q?: string;
  onlyPreview?: boolean;
  offset?: number;
  limit?: number;
};

export type EntriesPage = {
  entries: SitePageEntry[];
  total: number;
  offset: number;
  limit: number;
  project: string | null;
};

let indexCache: { mtimeMs: number; index: SitesDriveIndex } | null = null;

export function loadCachedDriveIndex(): SitesDriveIndex | null {
  const p = driveIndexPath();
  if (!existsSync(p)) return null;
  try {
    const mtimeMs = statSync(p).mtimeMs;
    if (indexCache && indexCache.mtimeMs === mtimeMs) return indexCache.index;
    const index = JSON.parse(readFileSync(p, "utf8")) as SitesDriveIndex;
    if (!Array.isArray(index.entries)) return null;
    indexCache = { mtimeMs, index };
    return index;
  } catch {
    return null;
  }
}

function entryHasPreview(e: SitePageEntry): boolean {
  if (existsSync(capturePngAbsForId(e.id))) return true;
  if (e.pngRelPath && existsSync(e.pngRelPath)) return true;
  if (e.htmlRelPath && siblingPreviewPath(e.htmlRelPath)) return true;
  if (e.source !== "html" && /\.(png|jpe?g|webp|gif)$/i.test(e.absPath) && existsSync(e.absPath)) return true;
  return false;
}

export function enrichEntry(e: SitePageEntry): SitePageEntry {
  const captureAbs = capturePngAbsForId(e.id);
  const htmlPath = e.htmlRelPath ?? (e.source === "html" ? e.absPath : null);
  let preview: string | null = null;
  if (existsSync(captureAbs)) preview = captureAbs;
  else if (e.pngRelPath && existsSync(e.pngRelPath)) preview = e.pngRelPath;
  else if (htmlPath) preview = siblingPreviewPath(htmlPath);
  else if (e.source !== "html" && /\.(png|jpe?g|webp|gif)$/i.test(e.absPath) && existsSync(e.absPath)) {
    preview = e.absPath;
  }

  const hasPng = !!preview;
  return {
    ...e,
    pngRelPath: preview,
    hasPng,
    imageHref: hasPng ? imageApiHref(e.id) : null,
    launchHref: e.launchHref || fileLaunchHref(htmlPath ?? e.absPath),
  };
}

export function loadSitesGalleryMeta(): SitesGalleryMeta {
  const index = loadCachedDriveIndex() ?? loadDriveIndex();
  if (index) {
    return {
      scannedAt: index.builtAt,
      sitesRoot: index.scanRoots.join(", "),
      scanRoots: index.scanRoots,
      indexPath: driveIndexPath(),
      usingDriveIndex: true,
      pageCount: index.entryCount,
      withPng: index.withPng,
      rootSummaries: index.rootSummaries ?? [],
      projectSummaries: index.projectSummaries ?? [],
    };
  }

  return {
    scannedAt: new Date().toISOString(),
    sitesRoot: "",
    scanRoots: [],
    indexPath: null,
    usingDriveIndex: false,
    pageCount: 0,
    withPng: 0,
    rootSummaries: [],
    projectSummaries: [],
  };
}

export function queryIndexEntries(query: EntriesQuery): EntriesPage {
  const index = loadCachedDriveIndex();
  const offset = Math.max(0, query.offset ?? 0);
  const limit = Math.min(200, Math.max(1, query.limit ?? 48));
  const project = query.project?.trim() || null;
  const needle = query.q?.trim().toLowerCase() ?? "";
  const onlyPreview = query.onlyPreview === true;

  if (!index) {
    return { entries: [], total: 0, offset, limit, project };
  }

  let rows = index.entries;

  if (project) rows = rows.filter((e) => e.folderGroup === project);
  if (onlyPreview) rows = rows.filter(entryHasPreview);
  if (needle) {
    rows = rows.filter((e) => `${e.label} ${e.absPath} ${e.folderGroup}`.toLowerCase().includes(needle));
  }

  rows = [...rows].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  const total = rows.length;
  const entries = rows.slice(offset, offset + limit).map(enrichEntry);

  return { entries, total, offset, limit, project };
}

export function projectCoverEntry(project: string): SitePageEntry | null {
  const index = loadCachedDriveIndex();
  if (!index) return null;
  const raw = index.entries.find((e) => e.folderGroup === project && entryHasPreview(e));
  return raw ? enrichEntry(raw) : null;
}
