import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";

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
  return `retroverse/covers/${albumId.trim().toUpperCase()}/canonical.jpg`;
}

function envPresent(name: string): boolean {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0;
}

/** Logs presence only — never secret values. */
export function logCuratorR2EnvPresence(traceId: string): void {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? "";
  console.log("[CURATOR/API] env_validation", {
    traceId,
    NODE_ENV: process.env.NODE_ENV ?? null,
    R2_ACCOUNT_ID_present: envPresent("R2_ACCOUNT_ID"),
    R2_ACCESS_KEY_ID_present: envPresent("R2_ACCESS_KEY_ID"),
    R2_SECRET_ACCESS_KEY_present: envPresent("R2_SECRET_ACCESS_KEY"),
    R2_BUCKET_NAME_present: envPresent("R2_BUCKET_NAME"),
    R2_ENDPOINT_preview: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null,
    RETROVERSE_COVER_BASE_URL_present: envPresent("RETROVERSE_COVER_BASE_URL"),
    NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL_present: envPresent("NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL"),
    SUPABASE_URL_present: envPresent("SUPABASE_URL") || envPresent("NEXT_PUBLIC_SUPABASE_URL"),
    SUPABASE_SERVICE_ROLE_KEY_present: envPresent("SUPABASE_SERVICE_ROLE_KEY"),
    CANONICAL_ARTWORK_OVERRIDES_USE_LOCAL_ONLY: process.env.CANONICAL_ARTWORK_OVERRIDES_USE_LOCAL_ONLY ?? null,
    CANONICAL_ARTWORK_OVERRIDES_USE_R2: process.env.CANONICAL_ARTWORK_OVERRIDES_USE_R2 ?? null,
  });
}

/** HEAD object after PutObject — confirms R2 write is readable. */
export async function headR2Object(args: {
  key: string;
  traceId: string;
}): Promise<{ ok: true; etag: string | null; contentLength: number | null } | { ok: false; error: string }> {
  try {
    const client = getR2Client();
    const res = await client.send(
      new HeadObjectCommand({
        Bucket: r2Bucket(),
        Key: args.key,
      }),
    );
    return {
      ok: true,
      etag: res.ETag ?? null,
      contentLength: typeof res.ContentLength === "number" ? res.ContentLength : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[CURATOR/R2] head_failed", { traceId: args.traceId, key: args.key, error: msg });
    return { ok: false, error: msg };
  }
}
