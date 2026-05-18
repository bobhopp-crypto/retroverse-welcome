import path from "node:path";

import { resolveArchiveRoots } from "./roots";

const ALLOWED_EXT = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".svg",
  ".txt",
  ".md",
]);

export function resolveSafeArchiveFile(relPathParam: string): { abs: string; rel: string } | null {
  const relPath = relPathParam.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relPath || relPath.includes("..")) return null;

  const { monorepoRoot } = resolveArchiveRoots();
  const abs = path.resolve(monorepoRoot, relPath);
  const rootResolved = path.resolve(monorepoRoot);
  if (!abs.startsWith(rootResolved + path.sep) && abs !== rootResolved) return null;

  const ext = path.extname(abs).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return null;

  return { abs, rel: relPath };
}
