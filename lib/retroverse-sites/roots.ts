import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SITES_ROOT = path.join(os.homedir(), "Sites");

function expandHome(p: string): string {
  return path.resolve(p.replace(/^~/, os.homedir()));
}

/** Personal projects root — only ~/Sites (never / or home). */
export function resolveSitesProjectsRoot(): string {
  const env = process.env.SITES_PROJECTS_ROOT?.trim() || process.env.RETROVERSE_SITES_SCAN_ROOTS?.trim();
  if (env && !env.includes(",")) {
    const single = expandHome(env);
    if (isAllowedSitesRoot(single)) return single;
  }
  if (existsSync(DEFAULT_SITES_ROOT)) return DEFAULT_SITES_ROOT;
  return DEFAULT_SITES_ROOT;
}

export function isAllowedSitesRoot(absRoot: string): boolean {
  const norm = absRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const lower = norm.toLowerCase();
  const home = os.homedir().replace(/\\/g, "/");
  const defaultSites = DEFAULT_SITES_ROOT.replace(/\\/g, "/").toLowerCase();

  if (lower === "/" || lower === "/users" || lower === home) return false;
  if (lower === `${home}/documents` || lower === `${home}/downloads`) return false;

  return lower === defaultSites || lower.startsWith(`${defaultSites}/`);
}

/** @deprecated */
export function resolveLegacySitesRoot(): string {
  const legacy = path.join(resolveSitesProjectsRoot(), "Retroverse");
  if (existsSync(legacy)) return legacy;
  return resolveSitesProjectsRoot();
}

export const resolveSitesRoot = resolveLegacySitesRoot;

/** Index scan roots — default: ~/Sites only. */
export function resolveDriveScanRoots(): string[] {
  const raw = process.env.RETROVERSE_SITES_SCAN_ROOTS?.trim() || process.env.SITES_PROJECTS_ROOT?.trim();
  if (raw) {
    const roots = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(expandHome)
      .filter((r) => {
        if (!isAllowedSitesRoot(r)) {
          console.warn(`[sites] Skipping disallowed root: ${r}`);
          return false;
        }
        return existsSync(r);
      });
    if (roots.length > 0) return roots;
  }

  const root = resolveSitesProjectsRoot();
  return existsSync(root) ? [root] : [];
}

export function defaultDriveScanRootsLabel(roots: string[]): string {
  if (roots.length === 1) return roots[0]!;
  return roots.join(", ");
}

/** @deprecated */
export const isAllowedArchaeologyRoot = isAllowedSitesRoot;
