import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { PutObjectCommand } from "@aws-sdk/client-s3";

import {
  assessArtworkQuality,
  type ArtworkQualityReport,
} from "@/lib/curator-artwork-quality";
import { canonicalCoverPathToUrl, getRetroverseCoverBaseUrl } from "@/lib/canonical-cover-url";
import { curatorPipelineLog } from "@/lib/curator-pipeline-log";
import { isServerlessPublicRuntime } from "@/lib/curator-runtime-strategy";
import { canonicalCoverKey, getR2Client, headR2Object, r2Bucket } from "@/lib/r2-client";

export type CoverStorage = "local" | "r2";
export type CoverPersistTimings = Record<string, number>;
export type CoverPersistResult = {
  canonicalPath: string;
  storage: CoverStorage;
  quality: ArtworkQualityReport;
  timings: CoverPersistTimings;
};

export class ArtworkQualityWarning extends Error {
  constructor(public readonly quality: ArtworkQualityReport) {
    super("artwork_quality_warning");
    this.name = "ArtworkQualityWarning";
  }
}

export function isValidRvalAlbumId(albumId: string): boolean {
  return /^RVAL\d{6}$/i.test(albumId.trim());
}

export function normalizeRvalAlbumId(albumId: string): string {
  return albumId.trim().toUpperCase();
}

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
}

/** Browser path served from `public/` (leading slash). */
export function localCanonicalCoverWebPath(albumId: string): string {
  return `/retroverse/covers/${normalizeRvalAlbumId(albumId)}/canonical.jpg`;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_BUCKET_NAME?.trim(),
  );
}

export async function writeCanonicalCoverToPublicDir(
  albumId: string,
  bytes: Buffer,
): Promise<string> {
  const webPath = localCanonicalCoverWebPath(albumId);
  const abs = path.join(process.cwd(), "public", webPath.replace(/^\//, ""));
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, bytes);
  curatorPipelineLog("local_db_write", {
    ok: true,
    kind: "public_cover_file",
    albumId: normalizeRvalAlbumId(albumId),
    webPath,
    byteSize: bytes.length,
  });
  return webPath;
}

async function uploadCoverBytesToR2(args: {
  albumId: string;
  bytes: Buffer;
  contentType: string;
  traceId: string;
}): Promise<{ canonicalKey: string }> {
  const client = getR2Client();
  const canonicalKey = canonicalCoverKey(args.albumId);
  await client.send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: canonicalKey,
      Body: args.bytes,
      ContentType: args.contentType,
      CacheControl: "public, max-age=300, must-revalidate",
    }),
  );
  curatorPipelineLog("r2_upload", { traceId: args.traceId, ok: true, canonicalKey, byteSize: args.bytes.length });
  return { canonicalKey };
}

/**
 * Persist cover bytes: try R2 when configured; on failure use local public/ fallback only
 * in persistent/local runtimes. Serverless public deployments must use R2.
 */
export async function persistCoverBytes(opts: {
  albumId: string;
  bytes: Buffer;
  contentType: string;
  traceId: string;
  sourceUrl?: string | null;
  allowUsableQuality?: boolean;
}): Promise<CoverPersistResult> {
  const albumId = normalizeRvalAlbumId(opts.albumId);
  const timings: CoverPersistTimings = {};
  const qualityStart = performance.now();
  const quality = await assessArtworkQuality(opts.bytes, opts.sourceUrl ?? null);
  timings.quality_assessment = elapsedMs(qualityStart);
  curatorPipelineLog("artwork_quality", {
    traceId: opts.traceId,
    ok: quality.tier !== "unusable",
    tier: quality.tier,
    width: quality.width,
    height: quality.height,
    format: quality.format,
    byteSize: quality.byteSize,
    sourceUrl: quality.sourceUrl,
    thresholds: quality.thresholds,
  });
  if (quality.tier === "unusable") {
    throw new Error(`image_unusable_thumbnail:${quality.width}x${quality.height}:${quality.byteSize}`);
  }
  if (quality.tier === "usable" && !opts.allowUsableQuality) {
    throw new ArtworkQualityWarning(quality);
  }

  const serverlessPublic = isServerlessPublicRuntime();
  if (serverlessPublic && !isR2Configured()) {
    throw new Error("r2_not_configured_for_serverless_public_runtime");
  }

  if (isR2Configured()) {
    try {
      const uploadStart = performance.now();
      const r2 = await uploadCoverBytesToR2({
        albumId,
        bytes: opts.bytes,
        contentType: opts.contentType,
        traceId: opts.traceId,
      });
      timings.r2_upload = elapsedMs(uploadStart);
      const verifyStart = performance.now();
      const head = await headR2Object({ key: r2.canonicalKey, traceId: opts.traceId });
      timings.r2_verify = elapsedMs(verifyStart);
      curatorPipelineLog("r2_verify", {
        traceId: opts.traceId,
        ok: head.ok,
        key: r2.canonicalKey,
        error: head.ok ? undefined : head.error,
      });
      return { canonicalPath: r2.canonicalKey, storage: "r2", quality, timings };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      curatorPipelineLog("r2_upload", { traceId: opts.traceId, ok: false, error: msg });
      if (serverlessPublic || process.env.NODE_ENV === "production") {
        throw new Error(`r2_upload_failed:${msg}`);
      }
    }
  }

  const localPersistStart = performance.now();
  const webPath = await writeCanonicalCoverToPublicDir(albumId, opts.bytes);
  timings.local_persistence = elapsedMs(localPersistStart);
  return { canonicalPath: webPath, storage: "local", quality, timings };
}

export function buildDisplayUrl(
  canonicalPath: string | null,
  cacheBust: number,
  storage?: CoverStorage,
): string | null {
  if (!canonicalPath?.trim()) return null;
  const trimmed = canonicalPath.trim();
  const useSiteOrigin =
    storage === "local" || trimmed.startsWith("/retroverse/covers/");
  return canonicalCoverPathToUrl(trimmed, {
    cacheBust,
    coverBaseUrl: useSiteOrigin ? null : getRetroverseCoverBaseUrl(),
  });
}

export async function readCoverBytesFromStaged(stagedPath: string): Promise<Buffer> {
  return readFile(stagedPath);
}

export async function fetchRemoteCoverBytes(remote: URL, traceId: string): Promise<Buffer> {
  curatorPipelineLog("r2_upload", { traceId, step: "image_download_start", host: remote.host });
  const res = await fetch(remote, {
    headers: {
      "User-Agent": "RetroverseCurator/1.0 (+https://retroverse.live)",
      Referer: "https://www.discogs.com/",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    throw new Error(`remote_fetch_failed_${res.status}`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  curatorPipelineLog("r2_upload", {
    traceId,
    step: "image_download_done",
    byteSize: bytes.length,
  });
  return bytes;
}
