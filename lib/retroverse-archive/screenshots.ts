import { existsSync } from "node:fs";
import path from "node:path";

import { resolveArchiveRoots } from "./roots";

export const SCREENSHOT_DIR_REL = "reports/retroverse-archive/screenshots";

export function screenshotDirAbs(appRoot?: string): string {
  const root = appRoot ?? resolveArchiveRoots().appRoot;
  return path.join(root, SCREENSHOT_DIR_REL);
}

export function screenshotAbsForId(artifactId: string, appRoot?: string): string {
  const safe = artifactId.replace(/[^a-f0-9]/gi, "");
  return path.join(screenshotDirAbs(appRoot), `${safe}.png`);
}

export function screenshotRelFromMonorepo(artifactId: string, appRoot?: string): string {
  const { monorepoRoot, appRoot: app } = resolveArchiveRoots();
  const abs = screenshotAbsForId(artifactId, appRoot ?? app);
  return path.relative(monorepoRoot, abs).split(path.sep).join("/");
}

export function screenshotExists(artifactId: string, appRoot?: string): boolean {
  return existsSync(screenshotAbsForId(artifactId, appRoot));
}

export function screenshotApiHref(artifactId: string): string {
  return `/api/retroverse-archive/screenshot?id=${encodeURIComponent(artifactId)}`;
}

export function captureUrlForArtifact(
  artifact: { id: string; launchHref: string | null; rawHref: string | null; kind: string },
  baseUrl: string,
): string | null {
  const base = baseUrl.replace(/\/$/, "");
  if (artifact.launchHref && (artifact.kind === "next-route" || artifact.kind === "sibling-app" || artifact.kind === "api-route")) {
    return `${base}${artifact.launchHref}`;
  }
  if (artifact.rawHref && artifact.kind === "html-static") {
    return `${base}${artifact.rawHref}`;
  }
  return null;
}
