import { S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2 (S3-compatible) client used by the curator save path.
 *
 * Required server-side env vars:
 *   R2_ACCOUNT_ID         (Cloudflare account UUID — 32 hex chars)
 *   R2_ACCESS_KEY_ID      (R2 API token "Access Key ID")
 *   R2_SECRET_ACCESS_KEY  (R2 API token "Secret Access Key")
 *   R2_BUCKET_NAME        (e.g. "retroverse-covers")
 *
 * Public read URL is built separately via NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL
 * and the existing canonicalCoverPathToUrl resolver — this module never returns
 * a public URL, only the object key it just wrote.
 */

let cachedClient: S3Client | null = null;

function requireEnv(name: string): string {
  const raw = process.env[name];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) throw new Error(`missing_env:${name}`);
  return value;
}

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;
  const accountId = requireEnv("R2_ACCOUNT_ID");
  const accessKeyId = requireEnv("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnv("R2_SECRET_ACCESS_KEY");
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

export function r2Bucket(): string {
  return requireEnv("R2_BUCKET_NAME");
}

/** Canonical object key for an album cover. One file per album, overwrites in place. */
export function canonicalCoverKey(albumId: string): string {
  return `retroverse/covers/${albumId}/canonical.jpg`;
}
