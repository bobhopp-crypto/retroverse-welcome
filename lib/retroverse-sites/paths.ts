import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { capturePngAbsForId, driveIndexPath } from "./index-store";
import { imageApiHref } from "./image-urls";
import { resolveSitesProjectsRoot } from "./roots";

export { fileLaunchHref, imageApiHref, imageThumbHref } from "./image-urls";

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export function pageId(absOrRelPath: string): string {
  return createHash("sha1").update(absOrRelPath).digest("hex").slice(0, 12);
}

export function mimeForPath(abs: string): string {
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

type ManifestEntry = {
  id: string;
  absPath: string;
  pngRelPath?: string | null;
  hasPng?: boolean;
};

let manifestCache: Map<string, { previewAbs: string | null; absPath: string }> | null = null;

export function clearSitesManifestCache(): void {
  manifestCache = null;
}

function loadManifestMap(): Map<string, { previewAbs: string | null; absPath: string }> {
  if (manifestCache) return manifestCache;
  const map = new Map<string, { previewAbs: string | null; absPath: string }>();
  const p = driveIndexPath();
  if (!existsSync(p)) {
    manifestCache = map;
    return map;
  }
  try {
    const data = JSON.parse(readFileSync(p, "utf8")) as { entries?: ManifestEntry[] };
    for (const e of data.entries ?? []) {
      const preview =
        e.pngRelPath ??
        (e.hasPng && IMAGE_EXT.test(e.absPath) ? e.absPath : null);
      map.set(e.id, { absPath: e.absPath, previewAbs: preview });
    }
  } catch {
    /* empty */
  }
  manifestCache = map;
  return map;
}

export type ImageResolveResult = {
  abs: string;
  mime: string;
  source: "index-preview" | "index-abs" | "capture-cache" | "sites-rel";
};

function firstExisting(paths: string[]): string | null {
  for (const p of paths) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

export function resolveIndexedImage(id: string): ImageResolveResult | null {
  if (!/^[a-f0-9]{12}$/i.test(id)) return null;

  const row = loadManifestMap().get(id);
  const captureAbs = capturePngAbsForId(id);

  const fromIndex = firstExisting([
    row?.previewAbs ?? "",
    row && IMAGE_EXT.test(row.absPath) ? row.absPath : "",
  ]);
  if (fromIndex) {
    const source =
      row?.previewAbs && fromIndex === row.previewAbs ? "index-preview" : "index-abs";
    return { abs: fromIndex, mime: mimeForPath(fromIndex), source };
  }

  if (existsSync(captureAbs)) {
    return { abs: captureAbs, mime: "image/png", source: "capture-cache" };
  }

  return null;
}

export function resolveSitesFile(relOrId: string): ImageResolveResult | null {
  const t = relOrId.trim();
  if (/^[a-f0-9]{12}$/i.test(t)) {
    return resolveIndexedImage(t);
  }
  const n = t.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!n || n.includes("..") || !IMAGE_EXT.test(n)) return null;
  const root = path.resolve(resolveSitesProjectsRoot());
  const abs = path.resolve(root, n);
  if (!abs.startsWith(root + path.sep) && abs !== root) return null;
  if (!existsSync(abs)) return null;
  return { abs, mime: mimeForPath(abs), source: "sites-rel" };
}

export function sitesImageDebugEnabled(): boolean {
  return process.env.SITES_IMAGE_DEBUG === "1";
}

export function logImageResolve(
  label: string,
  detail: {
    id?: string;
    rel?: string;
    browserUrl: string;
    abs: string | null;
    source?: string;
    exists: boolean;
  },
): void {
  if (!sitesImageDebugEnabled()) return;
  console.info(`[retroverse-sites/image] ${label}`, {
    id: detail.id,
    rel: detail.rel,
    browserUrl: detail.browserUrl,
    filesystemPath: detail.abs,
    source: detail.source,
    exists: detail.exists,
  });
}
