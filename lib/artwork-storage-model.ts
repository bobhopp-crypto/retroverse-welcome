import path from "node:path";

export const RETROVERSE_DATA_ROOT = "/Users/bobhopp/RETROVERSE_DATA";
export const ARTWORK_MASTER_ROOT = path.join(RETROVERSE_DATA_ROOT, "covers_master");
export const ARTWORK_STAGING_ROOT = path.join(RETROVERSE_DATA_ROOT, "artwork-intake");
export const ARTWORK_ITUNES_PASS_ROOT = path.join(ARTWORK_STAGING_ROOT, "itunes-pass");

export const RETROVERSE_WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";
export const ARTWORK_DEPLOY_ROOT = path.join(
  RETROVERSE_WORKSPACE_ROOT,
  "public",
  "retroverse",
  "covers",
);

// Runtime still serves deployed covers from `public/retroverse/covers`,
// but canonical source-of-truth for mastered files is `RETROVERSE_DATA/covers_master`.
export function deployedCanonicalPath(albumId: string, filename: string): string {
  return `public/retroverse/covers/${albumId}/${filename}`;
}

export function masterCoverPath(albumId: string, filename: string): string {
  return path.join(ARTWORK_MASTER_ROOT, albumId, filename);
}
