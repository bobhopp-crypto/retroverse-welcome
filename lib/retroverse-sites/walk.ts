import { readdir } from "node:fs/promises";
import path from "node:path";

import { MAX_INDEX_HTML, MAX_INDEX_IMAGES, SKIP_DIR_NAMES, SKIP_NESTED_IN_DIST_BUILD } from "./constants";
import { isMuseumHtmlPath, isMuseumImagePath } from "./filter";

export type WalkHit =
  | { kind: "html"; absPath: string; root: string }
  | { kind: "image"; absPath: string; root: string };

function shouldSkipDir(name: string, abs: string): boolean {
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (name.startsWith(".") && ![".v0", ".output"].includes(name)) return true;

  const norm = abs.replace(/\\/g, "/");
  if (/\/(node_modules|\.next\/|\.venv\/|vendor\/)(\/|$)/i.test(norm)) return true;

  if (SKIP_NESTED_IN_DIST_BUILD.has(name) && /\/(dist|build)\//i.test(norm)) return true;

  return false;
}

export type WalkResult = {
  html: number;
  images: number;
  skippedHtml: number;
  byProject: Map<string, { html: number; images: number }>;
};

function projectKey(absPath: string, sitesRoot: string): string {
  const norm = absPath.replace(/\\/g, "/");
  const root = sitesRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!norm.startsWith(root + "/")) return "other";
  return norm.slice(root.length + 1).split("/")[0] ?? "other";
}

export async function walkSitesProjects(
  sitesRoot: string,
  onHit: (hit: WalkHit) => void,
  limits = { html: MAX_INDEX_HTML, images: MAX_INDEX_IMAGES },
  options?: { projectFilter?: string },
): Promise<WalkResult> {
  const counts = { html: 0, images: 0, skippedHtml: 0 };
  const byProject = new Map<string, { html: number; images: number }>();
  const filterProject = options?.projectFilter?.trim().toLowerCase();

  function bumpProject(abs: string, kind: "html" | "images") {
    const key = projectKey(abs, sitesRoot);
    if (filterProject && key.toLowerCase() !== filterProject) return false;
    const row = byProject.get(key) ?? { html: 0, images: 0 };
    row[kind] += 1;
    byProject.set(key, row);
    return true;
  }

  async function walk(dir: string): Promise<void> {
    if (counts.html >= limits.html && counts.images >= limits.images) return;

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const ent of entries) {
      if (counts.html >= limits.html && counts.images >= limits.images) return;
      const abs = path.join(dir, ent.name);

      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name, abs)) continue;
        await walk(abs);
        continue;
      }
      if (!ent.isFile()) continue;

      if (/\.html?$/i.test(ent.name)) {
        if (!isMuseumHtmlPath(abs)) {
          counts.skippedHtml += 1;
          continue;
        }
        if (counts.html >= limits.html) continue;
        if (!bumpProject(abs, "html")) continue;
        counts.html += 1;
        onHit({ kind: "html", absPath: abs, root: sitesRoot });
        continue;
      }

      if (/\.(png|jpe?g|webp|gif)$/i.test(ent.name) && counts.images < limits.images && isMuseumImagePath(abs)) {
        if (!bumpProject(abs, "images")) continue;
        counts.images += 1;
        onHit({ kind: "image", absPath: abs, root: sitesRoot });
      }
    }
  }

  await walk(sitesRoot);
  return { ...counts, byProject };
}

/** @deprecated */
export const walkDriveRoots = async (
  roots: string[],
  onHit: (hit: WalkHit) => void,
  limits?: { html: number; png?: number },
) => {
  const sitesRoot = roots[0] ?? "";
  const merged = { html: 0, images: 0, skippedHtml: 0, byProject: new Map<string, { html: number; images: number }>() };
  for (const root of roots) {
    const r = await walkSitesProjects(
      root,
      onHit,
      { html: limits?.html ?? MAX_INDEX_HTML, images: limits?.png ?? MAX_INDEX_IMAGES },
    );
    merged.html += r.html;
    merged.images += r.images;
    merged.skippedHtml += r.skippedHtml;
    for (const [k, v] of r.byProject) {
      const prev = merged.byProject.get(k) ?? { html: 0, images: 0 };
      merged.byProject.set(k, { html: prev.html + v.html, images: prev.images + v.images });
    }
  }
  return {
    html: merged.html,
    png: merged.images,
    skippedHtml: merged.skippedHtml,
    byRoot: new Map([...merged.byProject.entries()].map(([k, v]) => [k, { html: v.html, png: v.images }])),
  };
};
