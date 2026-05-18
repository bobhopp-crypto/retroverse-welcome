import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SitePageEntry } from "./scan";

export type RootSummary = {
  root: string;
  html: number;
  png: number;
  entries: number;
};

export type ProjectSummary = {
  project: string;
  html: number;
  images: number;
  entries: number;
};

export type SitesDriveIndex = {
  builtAt: string;
  scanRoots: string[];
  entryCount: number;
  withPng: number;
  skippedHtml?: number;
  rootSummaries: RootSummary[];
  projectSummaries?: ProjectSummary[];
  entries: SitePageEntry[];
};

export function driveIndexPath(): string {
  const env = process.env.RETROVERSE_SITES_INDEX?.trim();
  if (env) return path.resolve(env);
  return path.join(process.cwd(), "data", "retroverse-sites-drive-index.json");
}

export function captureCacheDir(): string {
  return path.join(process.cwd(), "reports", "retroverse-sites-captures");
}

export function capturePngAbsForId(id: string): string {
  return path.join(captureCacheDir(), `${id}.png`);
}

export function loadDriveIndex(): SitesDriveIndex | null {
  const p = driveIndexPath();
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, "utf8");
    const data = JSON.parse(raw) as SitesDriveIndex;
    if (!Array.isArray(data.entries)) return null;
    return data;
  } catch {
    return null;
  }
}
