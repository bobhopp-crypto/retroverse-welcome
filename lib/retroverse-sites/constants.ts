/** Directory names always skipped when walking (tooling only — not visual exports). */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".venv",
  "__pycache__",
  ".next",
  "coverage",
  "vendor",
  "tmp",
  "cache",
  "Caches",
  "Cache",
  "DerivedData",
  ".Trash",
  ".npm",
  ".yarn",
  ".pnpm-store",
  "dist-pipeline",
  ".turbo",
  ".parcel-cache",
]);

/** Skip hashed bundle dirs inside dist/build (parent walk still enters dist/ for index.html). */
export const SKIP_NESTED_IN_DIST_BUILD = new Set(["assets", "static", "chunks", "_next"]);

export const MAX_INDEX_HTML = Number(process.env.SITES_INDEX_MAX_HTML ?? "30000") || 30000;
export const MAX_INDEX_IMAGES = Number(process.env.SITES_INDEX_MAX_IMAGES ?? "20000") || 20000;
export const MAX_CAPTURE = Number(process.env.SITES_CAPTURE_LIMIT ?? "500") || 500;
