import { existsSync } from "node:fs";
import path from "node:path";

import { resolveSitesProjectsRoot } from "./roots";

/** Tooling / dependency paths — never index. */
const BLOCKED_INFRA_RE =
  /\/(node_modules|\.next\/|\.git\/|\.venv\/|vendor\/|coverage\/|\/tmp\/|\/cache\/|Caches\/|DerivedData\/|__pycache__\/|\.pnpm-store\/|\.npm\/|\.yarn\/)(\/|$)/i;

/** Webpack/Vite hashed bundles — not museum artifacts. */
const BUNDLER_ASSET_RE =
  /\/(dist|build)\/(assets|static|chunks?)\/[^/]*[a-f0-9]{8,}[^/]*\.[a-z0-9]+$/i;

const FRAMEWORK_NOISE_HTML_RE = /\/(404|_not-found|_error)\.html$/i;

const TINY_ICON_DIR_RE = /\/(favicons?|icons)\/[^/]+\.(png|jpe?g|ico|webp|svg)$/i;

export type MuseumHints = {
  likelyEntrypoint?: boolean;
  hasCharts?: boolean;
  hasMedia?: boolean;
  hasUi?: boolean;
};

/** Any HTML under ~/Sites unless infrastructure or framework noise. */
export function isMuseumHtmlPath(absPath: string): boolean {
  const norm = absPath.replace(/\\/g, "/");
  if (BLOCKED_INFRA_RE.test(norm)) return false;
  if (BUNDLER_ASSET_RE.test(norm)) return false;
  if (FRAMEWORK_NOISE_HTML_RE.test(norm)) return false;
  return /\.html?$/i.test(norm);
}

/** Any preview image under ~/Sites unless infrastructure or hashed bundles. */
export function isMuseumImagePath(absPath: string): boolean {
  const norm = absPath.replace(/\\/g, "/");
  if (BLOCKED_INFRA_RE.test(norm)) return false;
  if (BUNDLER_ASSET_RE.test(norm)) return false;
  if (TINY_ICON_DIR_RE.test(norm)) return false;
  if (!/\.(png|jpe?g|webp|gif)$/i.test(norm)) return false;
  return true;
}

/** @deprecated */
export const isArchaeologyHtmlPath = isMuseumHtmlPath;

/** @deprecated */
export const isPreviewImagePath = isMuseumImagePath;

export function siblingPreviewPath(htmlAbs: string): string | null {
  const base = htmlAbs.replace(/\.html?$/i, "");
  for (const ext of [".png", ".jpg", ".jpeg", ".webp"]) {
    const candidate = base + ext;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Path-only hints (never used to exclude indexing). */
export function museumHintsForPath(absPath: string, kind: "html" | "image"): MuseumHints {
  const norm = absPath.replace(/\\/g, "/");
  const base = path.basename(norm);
  const hints: MuseumHints = {};

  if (kind === "html") {
    hints.likelyEntrypoint = /^(index|main|home|app|demo|start|portal|dashboard)\.html?$/i.test(base);
    hints.hasCharts = /(chart|timeline|graph|dashboard|plot|analytics)/i.test(norm);
    hints.hasMedia = /(video|media|player|audio|stream|mp4|clip)/i.test(norm);
    hints.hasUi = /(ui|interface|prototype|mockup|wireframe|component|layout)/i.test(norm);
  } else {
    hints.hasUi = /(screenshot|preview|mockup|wireframe|ui|demo)/i.test(norm);
  }

  return hints;
}

/** Top-level project folder under ~/Sites. */
export function projectGroupFor(absPath: string, sitesRoot?: string): string {
  const root = (sitesRoot ?? resolveSitesProjectsRoot()).replace(/\\/g, "/").replace(/\/+$/, "");
  const norm = absPath.replace(/\\/g, "/");
  if (norm.startsWith(root + "/")) {
    const rest = norm.slice(root.length + 1);
    return rest.split("/")[0] || "(root)";
  }
  const sitesIdx = norm.toLowerCase().indexOf("/sites/");
  if (sitesIdx >= 0) {
    const after = norm.slice(sitesIdx + "/sites/".length);
    return after.split("/")[0] || "Sites";
  }
  return path.basename(path.dirname(absPath));
}

/** @deprecated alias */
export const folderGroupFor = projectGroupFor;
