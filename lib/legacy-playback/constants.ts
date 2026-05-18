import path from "node:path";

/** Public R2 / CDN origin used by legacy `video_lookup.json` rows. */
export const LEGACY_MEDIA_BASE_URL =
  process.env.LEGACY_MEDIA_BASE_URL?.trim() || "https://media.retroverse.live";

/** Legacy charts_app slug → R2 lookup (titleSlug|artistSlug keys). */
export const DEFAULT_VIDEO_LOOKUP_PATH =
  process.env.LEGACY_VIDEO_LOOKUP_PATH?.trim() ||
  "/Users/bobhopp/Sites/retroverse/apps/charts_app/data/video_lookup.json";

/** Optional `video_cache.json` in artist__title shape (music-browser public/data). */
export const DEFAULT_VIDEO_CACHE_PATH =
  process.env.LEGACY_VIDEO_CACHE_PATH?.trim() ||
  path.join(process.cwd(), "public", "data", "legacy", "video_cache.json");
