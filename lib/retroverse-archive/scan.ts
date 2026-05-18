import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  inferDescription,
  inferKind,
  inferTags,
  primaryGroup,
} from "./classify";
import { listWorkspaceApps, resolveArchiveRoots } from "./roots";
import { screenshotApiHref, screenshotExists } from "./screenshots";
import type { ArchiveArtifact, ArchiveGroup, ArchiveScanResult } from "./types";

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".git",
  ".turbo",
  "cache",
  ".cache",
  "coverage",
  "__pycache__",
  "public",
  "data",
  "supabase",
  "scripts",
]);

/** Only walk these workspace subtrees (avoids 30k+ public/ assets). */
const WORKSPACE_SCAN_ROOTS = ["app", "portal-prototype", "reports", "docs"] as const;

function isUnderArchiveScreenshots(relPath: string): boolean {
  return /\/reports\/retroverse-archive\/screenshots\//i.test(relPath.replace(/\\/g, "/"));
}

const SCAN_EXT = new Set([
  ".html",
  ".htm",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
  ".css",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".md",
]);

const MAX_FILES = 2500;
const MAX_DEPTH = 14;

function shouldSkipDir(dirName: string, absDir: string): boolean {
  if (SKIP_DIR_NAMES.has(dirName)) return true;
  const norm = absDir.replace(/\\/g, "/");
  if (dirName === "dist" && /node_modules/.test(norm)) return true;
  if (dirName === "data" && /\/data\/raw\b|\/data\/snapshots\b|\/data\/imports\b/.test(norm)) return true;
  return false;
}

function pagePathToRoute(pageRel: string): string {
  let r = pageRel.replace(/^app\//, "").replace(/\/page\.(tsx|ts|jsx|js)$/, "");
  if (!r) return "/";
  return `/${r}`;
}

function relFromRoot(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}

function artifactId(relPath: string): string {
  return createHash("sha1").update(relPath).digest("hex").slice(0, 12);
}

function rawHrefFor(relPath: string): string {
  return `/api/retroverse-archive/raw?path=${encodeURIComponent(relPath)}`;
}

function isInterestingFile(relPath: string): boolean {
  const p = relPath.replace(/\\/g, "/");
  const base = path.posix.basename(p);
  const ext = path.posix.extname(p).toLowerCase();

  if (base === "page.tsx" || base === "page.ts" || base === "page.jsx" || base === "page.js") return true;
  if (base === "route.ts" || base === "route.js") return p.includes("/app/api/");
  if (p.endsWith(".legacy.tsx") || p.endsWith(".legacy.ts")) return true;
  if (ext === ".html") return true;
  if (ext === ".md" && /\/(docs|reports)\//.test(p)) return true;
  if (/\.(png|jpe?g|webp|gif|svg)$/i.test(p)) {
    return /(portal-prototype|prototype|screenshot|archive|reports|\.v0\/|v0\/)/i.test(p);
  }
  if (/\/portal-prototype\//i.test(p) && SCAN_EXT.has(ext)) return true;
  if (/\/\.v0\//i.test(p) || /\/v0\//i.test(p)) return true;
  if (/(vdj|virtualdj)/i.test(p) && /\.(tsx?|md|html)$/i.test(p)) return true;
  return false;
}

async function walkWorkspace(
  monorepoRoot: string,
  workspaceAbs: string,
  appRoot: string,
  acc: ArchiveArtifact[],
  state: { count: number },
): Promise<void> {
  const workspaceName = path.basename(workspaceAbs);
  const isActiveApp = path.resolve(workspaceAbs) === path.resolve(appRoot);

  async function walk(dir: string, depth: number): Promise<void> {
    if (state.count >= MAX_FILES || depth > MAX_DEPTH) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (state.count >= MAX_FILES) return;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name, abs)) continue;
        await walk(abs, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;

      const relPath = relFromRoot(monorepoRoot, abs);
      if (isUnderArchiveScreenshots(relPath)) continue;
      if (!isInterestingFile(relPath)) continue;

      const st = await stat(abs).catch(() => null);
      if (!st) continue;

      const kind = inferKind(relPath, false);
      if (kind === "other" && !relPath.includes("portal-prototype")) continue;

      let label = path.posix.basename(relPath);
      let launchHref: string | null = null;
      let routableHere = false;

      if (kind === "next-route" && relPath.includes("/app/")) {
        const appIdx = relPath.indexOf("/app/");
        const pageRel = relPath.slice(appIdx + 1);
        const route = pagePathToRoute(pageRel);
        label = route;
        if (isActiveApp) {
          launchHref = route;
          routableHere = true;
        }
      } else if (kind === "html-static") {
        launchHref = null;
        routableHere = false;
      } else if (kind === "api-route") {
        const m = relPath.match(/\/app\/api\/(.+)\/route\.[tj]sx?$/);
        label = m ? `/api/${m[1]}` : label;
        if (isActiveApp) {
          launchHref = label;
          routableHere = true;
        }
      }

      const tags = inferTags(relPath, kind);
      const group = primaryGroup(relPath, kind, tags);
      const description = inferDescription(relPath, kind, label);

      let previewHref: string | null = null;
      const rawHref = rawHrefFor(relPath);
      if (/\.(png|jpe?g|webp|gif|svg)$/i.test(relPath)) {
        previewHref = rawHref;
      } else if (kind === "html-static") {
        previewHref = rawHref;
      }
      // Routable routes: no default iframe preview (loads hundreds of pages and freezes the browser).

      const id = artifactId(relPath);
      const hasScreenshot = isActiveApp && screenshotExists(id);

      const artifact: ArchiveArtifact = {
        id,
        kind: isActiveApp ? kind : kind === "next-route" ? "sibling-app" : kind,
        group,
        tags,
        relPath,
        label,
        description,
        modifiedAt: st.mtime.toISOString(),
        launchHref,
        rawHref: kind === "html-static" || /\.(png|jpe?g|webp|gif|svg|css)$/i.test(relPath) ? rawHref : null,
        previewHref,
        screenshotHref: hasScreenshot ? screenshotApiHref(id) : null,
        workspace: workspaceName,
        routableHere,
      };

      acc.push(artifact);
      state.count += 1;
    }
  }

  for (const rootName of WORKSPACE_SCAN_ROOTS) {
    const rootAbs = path.join(workspaceAbs, rootName);
    if (existsSync(rootAbs)) await walk(rootAbs, 0);
  }
}

function emptyGroups(): Record<ArchiveGroup, ArchiveArtifact[]> {
  return {
    chart_systems: [],
    portal_systems: [],
    vdj_systems: [],
    experiments: [],
    exports: [],
    version: [],
    prototype_type: [],
  };
}

export async function scanRetroverseArchive(): Promise<ArchiveScanResult> {
  const { monorepoRoot, appRoot } = resolveArchiveRoots();
  const workspaces = listWorkspaceApps(monorepoRoot, appRoot);
  const all: ArchiveArtifact[] = [];
  const state = { count: 0 };

  for (const ws of workspaces) {
    await walkWorkspace(monorepoRoot, ws, appRoot, all, state);
  }

  all.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

  const groups = emptyGroups();
  for (const a of all) {
    groups[a.group].push(a);
  }

  return {
    scannedAt: new Date().toISOString(),
    monorepoRoot,
    workspaces: workspaces.map((w) => path.basename(w)),
    artifactCount: all.length,
    groups,
    all,
  };
}
