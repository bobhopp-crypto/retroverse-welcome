import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";

import {
  CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG,
  writeCanonicalArtworkOverride,
  pickCanonicalCoverPathForAlbum,
} from "@/lib/canonical-artwork-overrides";
import {
  loadArtworkStateRegistry,
  saveArtworkStateRegistry,
  upsertArtworkState,
  type LivingArtworkState,
} from "@/lib/artwork-living-archive";
import {
  ARTWORK_DEPLOY_ROOT,
  ARTWORK_ITUNES_PASS_ROOT,
  ARTWORK_MASTER_ROOT,
  masterCoverPath,
} from "@/lib/artwork-storage-model";
import { canonicalCoverPathToUrl, getRetroverseCoverBaseUrl } from "@/lib/canonical-cover-url";
import { canonicalCoverKey, getR2Client, headR2Object, logCuratorR2EnvPresence, r2Bucket } from "@/lib/r2-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STAGED_PREFIX = `${ARTWORK_ITUNES_PASS_ROOT}/`;
const ALLOWED_DEPLOYED_PREFIX = `${ARTWORK_DEPLOY_ROOT}/`;

type Action =
  | "approve"
  | "reject"
  | "clear_artwork"
  | "replace_artwork"
  | "mark_verified"
  | "mark_needs_review";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function statusForState(state: LivingArtworkState): "missing" | "pending" | "verified" | "rejected" {
  if (state === "canonical_verified" || state === "manually_corrected") return "verified";
  if (state === "low_confidence") return "rejected";
  if (state === "unresolved") return "missing";
  return "pending";
}

function discoverTrustForLivingState(nextState: LivingArtworkState): "verified" | "provisional" | "unresolved" {
  if (nextState === "canonical_verified" || nextState === "manually_corrected") return "verified";
  if (nextState === "needs_review" || nextState === "provisional") return "provisional";
  return "unresolved";
}

function allowedStagedPath(input: string | null | undefined): string | null {
  if (!input) return null;
  const resolved = path.resolve(input);
  if (!resolved.startsWith(ALLOWED_STAGED_PREFIX) && !resolved.startsWith(ALLOWED_DEPLOYED_PREFIX)) return null;
  return resolved;
}

function allowedRemoteImage(urlInput: string | null | undefined): URL | null {
  if (!urlInput) return null;
  try {
    const parsed = new URL(urlInput);
    if (parsed.protocol !== "https:") return null;
    const host = parsed.hostname.toLowerCase();
    /** Manual replace accepts Discogs-hosted artwork URLs only. */
    if (host === "discogs.com" || host.endsWith(".discogs.com")) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * Push bytes to R2 at the canonical key for an album. The bucket already serves
 * `https://pub-….r2.dev/<key>` anonymously, so once this returns the public URL
 * derived from `canonicalCoverKey(albumId)` is live (modulo CDN propagation).
 *
 * One key per album → overwrites in place → cache-bust via `?v=<ts>` from the
 * client after a successful save (`canonicalCoverPathToUrl(path, { cacheBust })`).
 */
async function uploadCoverBytesToR2(args: {
  albumId: string;
  bytes: Buffer;
  contentType: string;
  traceId: string;
}): Promise<{ canonicalKey: string; byteSize: number; contentType: string }> {
  const client = getR2Client();
  const bucket = r2Bucket();
  const canonicalKey = canonicalCoverKey(args.albumId);

  console.log("[CURATOR/R2] cover_put_start", {
    traceId: args.traceId,
    bucket,
    canonicalKey,
    byteSize: args.bytes.length,
    contentType: args.contentType,
  });

  const putRes = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: canonicalKey,
      Body: args.bytes,
      ContentType: args.contentType,
      CacheControl: "public, max-age=300, must-revalidate",
    }),
  );

  console.log("[CURATOR/R2] cover_put_done", {
    traceId: args.traceId,
    canonicalKey,
    byteSize: args.bytes.length,
    etag: putRes.ETag ?? null,
  });

  const head = await headR2Object({ key: canonicalKey, traceId: args.traceId });
  console.log("[CURATOR/R2] cover_head_verify", {
    traceId: args.traceId,
    canonicalKey,
    headOk: head.ok,
    etag: head.ok ? head.etag : null,
    contentLength: head.ok ? head.contentLength : null,
    error: head.ok ? null : head.error,
  });
  if (!head.ok) {
    throw new Error(`cover_r2_head_failed:${head.error}`);
  }

  return { canonicalKey, byteSize: args.bytes.length, contentType: args.contentType };
}

function contentTypeForExtension(extension: string): string {
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

async function deployStagedCover(
  albumId: string,
  artist: string,
  title: string,
  stagedPath: string,
  traceId: string,
): Promise<{ canonicalPath: string; masterPath: string }> {
  const extension = (path.extname(stagedPath) || ".jpg").toLowerCase();
  const filename = `${albumId}__${slugify(artist)}__${slugify(title)}${extension}`;
  const masterAbsPath = masterCoverPath(albumId, filename);

  /**
   * Local FS mirror is a dev-only backup. On Vercel the master root lives on
   * the developer's machine and `public/` is read-only at runtime, so these
   * writes will EROFS/ENOENT. R2 (below) is the canonical write target.
   */
  const localMirrorEnabled = process.env.NODE_ENV !== "production";
  let bytes: Buffer;
  if (localMirrorEnabled) {
    await mkdir(path.dirname(masterAbsPath), { recursive: true });
    await copyFile(stagedPath, masterAbsPath);
    const deployAbsPath = path.join(ARTWORK_DEPLOY_ROOT, albumId, filename);
    await mkdir(path.dirname(deployAbsPath), { recursive: true });
    await copyFile(masterAbsPath, deployAbsPath);
    bytes = await readFile(masterAbsPath);
  } else {
    bytes = await readFile(stagedPath);
  }
  if (bytes.length < 8_000) throw new Error("staged_image_too_small");
  const r2 = await uploadCoverBytesToR2({
    albumId,
    bytes,
    contentType: contentTypeForExtension(extension),
    traceId,
  });

  return { canonicalPath: r2.canonicalKey, masterPath: path.relative(ARTWORK_MASTER_ROOT, masterAbsPath) };
}

async function deployRemoteCover(
  albumId: string,
  artist: string,
  title: string,
  remote: URL,
  traceId: string,
): Promise<{ canonicalPath: string; masterPath: string }> {
  /**
   * Discogs' image CDN (i.discogs.com) rejects requests without a real
   * User-Agent. ASCII only, identifies us, and is consistent with the rest of
   * the curator pipeline's outbound calls.
   */
  console.log("[CURATOR/API] image_download_start", {
    traceId,
    host: remote.host,
    pathnamePreview: remote.pathname.slice(0, 120),
  });
  const res = await fetch(remote, {
    headers: {
      "User-Agent": "RetroverseCurator/1.0 (+https://retroverse.live)",
      /** i.discogs.com (imgproxy) returns 403 without a Discogs.com referer. */
      Referer: "https://www.discogs.com/",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) {
    console.error("[CURATOR/API] image_download_failed", {
      traceId,
      httpStatus: res.status,
      host: remote.host,
    });
    throw new Error(`remote_fetch_failed_${res.status}`);
  }
  console.log("[CURATOR/API] image_download_done", {
    traceId,
    httpStatus: res.status,
    contentType: res.headers.get("content-type"),
  });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 8_000) throw new Error("remote_image_too_small");
  const ext = path.extname(remote.pathname).toLowerCase();
  const extension = ext === ".png" || ext === ".webp" || ext === ".jpg" || ext === ".jpeg" ? ext : ".jpg";

  /**
   * Local FS mirror is a dev-only backup; R2 is the source of truth. Skipped
   * in production where `ARTWORK_MASTER_ROOT` (laptop path) doesn't exist and
   * `public/` is read-only inside the serverless function.
   */
  const filename = `${albumId}__${slugify(artist)}__${slugify(title)}${extension}`;
  const masterAbsPath = masterCoverPath(albumId, filename);
  if (process.env.NODE_ENV !== "production") {
    await mkdir(path.dirname(masterAbsPath), { recursive: true });
    await writeFile(masterAbsPath, bytes);
    const deployAbsPath = path.join(ARTWORK_DEPLOY_ROOT, albumId, filename);
    await mkdir(path.dirname(deployAbsPath), { recursive: true });
    await copyFile(masterAbsPath, deployAbsPath);
  }

  /** Reuse the already-fetched buffer — never re-download. */
  const r2 = await uploadCoverBytesToR2({
    albumId,
    bytes,
    contentType: res.headers.get("content-type")?.toLowerCase().startsWith("image/")
      ? res.headers.get("content-type")!
      : contentTypeForExtension(extension),
    traceId,
  });

  /** canonicalPath now points to the R2 canonical key (no `public/` prefix). */
  return { canonicalPath: r2.canonicalKey, masterPath: path.relative(ARTWORK_MASTER_ROOT, masterAbsPath) };
}

function runRevalidate(traceId: string, albumId: string): void {
  const tags = [
    `artwork:${albumId}`,
    CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG,
    "viewer-bootstrap",
  ] as const;
  for (const tag of tags) {
    try {
      revalidateTag(tag, { expire: 0 });
      console.log("[CURATOR/REVALIDATE] tag_ok", { traceId, tag });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[CURATOR/REVALIDATE] tag_failed", { traceId, tag, error: msg });
    }
  }
  const paths = [
    "/album-retroscope",
    "/artist-retroscope",
    "/track-retroscope",
    `/albums/${encodeURIComponent(albumId)}`,
    "/portal-v2",
    "/discover",
    "/",
  ] as const;
  for (const p of paths) {
    try {
      revalidatePath(p);
      console.log("[CURATOR/REVALIDATE] path_ok", { traceId, path: p });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[CURATOR/REVALIDATE] path_failed", { traceId, path: p, error: msg });
    }
  }
}

export async function POST(request: Request) {
  const traceId = randomUUID().slice(0, 8);
  const ts = () => new Date().toISOString();

  logCuratorR2EnvPresence(traceId);

  console.log("[CURATOR/API] request_received", {
    traceId,
    ts: ts(),
    method: request.method,
    url: request.url,
    opsCookiePresent: request.headers.get("cookie")?.includes("retroverse_ops_gate=ok") ?? false,
  });

  let body: {
    action?: Action;
    albumId?: string;
    artist?: string;
    title?: string;
    runId?: string | null;
    confidence?: number | null;
    stagedFilePath?: string | null;
    queryUsed?: string | null;
    normalizedQuery?: string | null;
    sourceArtist?: string | null;
    sourceCollection?: string | null;
    sourceReleaseDate?: string | null;
    candidateSource?: string | null;
    candidateImageUrl?: string | null;
    replaceSource?: "discogs" | "staged" | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[CURATOR/API] request_json_parse_failed", { traceId, error: msg });
    return NextResponse.json({ ok: false, error: `invalid_json:${msg}`, traceId }, { status: 400 });
  }

  console.log("[CURATOR/API] request_body", {
    traceId,
    ts: ts(),
    action: body.action ?? null,
    albumId: body.albumId ?? null,
    replaceSource: body.replaceSource ?? null,
    candidateImageUrlPreview:
      typeof body.candidateImageUrl === "string" ? body.candidateImageUrl.slice(0, 120) : null,
    stagedFilePathPreview:
      typeof body.stagedFilePath === "string" ? body.stagedFilePath.slice(0, 120) : null,
  });

  if (!body.action || !body.albumId) {
    console.warn("[CURATOR/API] reject_missing_action_or_album", { traceId });
    return NextResponse.json({ ok: false, error: "missing_action_or_album", traceId }, { status: 400 });
  }

  const albumId = body.albumId.trim().toUpperCase();
  body.albumId = albumId;

  try {

  const registry = await loadArtworkStateRegistry();
  const beforePath = await pickCanonicalCoverPathForAlbum(albumId);
  const beforeSnapshot = {
    retroverse_album_id: body.albumId,
    canonical_cover_path: beforePath,
    artwork_status: null as string | null,
  };

  console.log("[CURATOR/API] before_local_cover", {
    traceId,
    existingCanonicalPath: beforePath ?? null,
  });

  const sourceTag = body.runId ? `workbench:${body.runId}` : "workbench:manual";
  const notes = `living-archive action=${body.action}; confidence=${body.confidence ?? "n/a"}; source=${body.sourceArtist ?? ""}::${body.sourceCollection ?? ""}; replace_source=${body.replaceSource ?? "n/a"}`;

  let nextState: LivingArtworkState = "needs_review";
  let canonicalPath: string | null = beforePath;

  if (body.action === "approve") nextState = "canonical_verified";
  if (body.action === "replace_artwork") nextState = "manually_corrected";
  if (body.action === "mark_verified") nextState = "canonical_verified";
  if (body.action === "mark_needs_review") nextState = "needs_review";
  if (body.action === "reject") nextState = "low_confidence";
  if (body.action === "clear_artwork") nextState = "unresolved";
  if (body.action === "mark_needs_review" && (body.confidence ?? 0) > 0) nextState = "provisional";

  let masterRelative: string | null = null;
  if (body.action === "approve" || body.action === "replace_artwork") {
    const stagedPath = allowedStagedPath(body.stagedFilePath);
    const remote = allowedRemoteImage(body.candidateImageUrl ?? null);
    console.log("[CURATOR/API] deploy_source_resolved", {
      traceId,
      hasStagedPath: Boolean(stagedPath),
      hasRemote: Boolean(remote),
      remoteHost: remote ? remote.host : null,
      remotePathPreview: remote ? remote.pathname.slice(0, 120) : null,
    });
    if (!stagedPath && !remote) {
      console.warn("[CURATOR/API] reject_missing_valid_replace_source", { traceId });
      return NextResponse.json({ ok: false, error: "missing_valid_replace_source", traceId }, { status: 400 });
    }
    console.log("[CURATOR/API] deploy_start", {
      traceId,
      mode: stagedPath ? "staged" : "remote",
    });
    let deployed;
    try {
      deployed = stagedPath
        ? await deployStagedCover(
            body.albumId,
            body.artist ?? "unknown-artist",
            body.title ?? "unknown-title",
            stagedPath,
            traceId,
          )
        : await deployRemoteCover(
            body.albumId,
            body.artist ?? "unknown-artist",
            body.title ?? "unknown-title",
            remote as URL,
            traceId,
          );
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[CURATOR/R2] deploy_failed", { traceId, error: msg });
      return NextResponse.json({ ok: false, error: `deploy_failed:${msg}`, traceId }, { status: 500 });
    }
    canonicalPath = deployed.canonicalPath;
    masterRelative = deployed.masterPath;
    console.log("[CURATOR/R2] deploy_done", {
      traceId,
      canonicalPath,
      masterPath: deployed.masterPath,
      r2_uploaded: true,
    });
  }
  if (body.action === "clear_artwork") canonicalPath = null;

  const status = statusForState(nextState);

  try {
    await writeCanonicalArtworkOverride(
      body.albumId,
      {
        canonical_cover_path: canonicalPath,
        artwork_status: status,
        trust_state: discoverTrustForLivingState(nextState),
        cover_source: sourceTag,
      },
      traceId,
    );
    console.log("[CURATOR/API] canonical_overrides_written", {
      traceId,
      canonicalPath,
      artwork_status: status,
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[CURATOR/API] override_write_failed", { traceId, error: msg });
    return NextResponse.json({ ok: false, error: `persist_failed:${msg}`, traceId }, { status: 500 });
  }

  runRevalidate(traceId, body.albumId);

  const afterSnapshot = {
    retroverse_album_id: body.albumId,
    /** Authoritative in-process value after write — do not re-pick here (would hit stale per-request memo). */
    canonical_cover_path: canonicalPath,
    artwork_status: statusForState(nextState),
  };
  upsertArtworkState(registry, {
    albumId: body.albumId,
    nextState,
    confidenceScore: body.confidence ?? null,
    provisional: nextState !== "canonical_verified" && nextState !== "manually_corrected",
    provenanceSource: sourceTag,
    provenanceRunId: body.runId ?? null,
    candidateArtist: body.sourceArtist ?? null,
    candidateCollection: body.sourceCollection ?? null,
    candidateReleaseDate: body.sourceReleaseDate ?? null,
    candidateArtworkUrl: body.candidateSource ?? null,
    stagedFile: body.stagedFilePath ?? null,
    queryUsed: body.queryUsed ?? null,
    normalizedQuery: body.normalizedQuery ?? null,
    appliedAt: new Date().toISOString(),
    action: body.action,
    actor: "curator",
    notes: `${notes}; master=${masterRelative ?? "n/a"}`,
    dbSnapshotBefore: beforeSnapshot as Record<string, unknown> | null,
    dbSnapshotAfter: afterSnapshot as Record<string, unknown> | null,
  });
  try {
    await saveArtworkStateRegistry(registry);
    console.log("[CURATOR/API] artwork_state_registry_saved", {
      traceId,
      skippedInProduction: process.env.NODE_ENV === "production",
    });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[CURATOR/API] artwork_state_registry_failed", { traceId, error: msg });
    return NextResponse.json({ ok: false, error: `registry_failed:${msg}`, traceId }, { status: 500 });
  }

  const savedAt = Date.now();
  const coverBaseUrl = getRetroverseCoverBaseUrl();
  const publicCoverUrl = canonicalCoverPathToUrl(canonicalPath, { cacheBust: savedAt, coverBaseUrl });

  if (
    process.env.NODE_ENV === "production" &&
    canonicalPath &&
    !canonicalPath.startsWith("http") &&
    !coverBaseUrl
  ) {
    console.error("[CURATOR/API] missing_cover_base_url", { traceId, albumId, canonicalPath });
    return NextResponse.json(
      {
        ok: false,
        error: "missing_RETROVERSE_COVER_BASE_URL",
        detail: "Set RETROVERSE_COVER_BASE_URL (R2 pub origin) on Vercel and redeploy.",
        traceId,
      },
      { status: 503 },
    );
  }

  const payload = {
    ok: true as const,
    albumId,
    action: body.action,
    nextState,
    canonicalPath,
    publicCoverUrl,
    coverBaseConfigured: Boolean(coverBaseUrl),
    savedAt,
    traceId,
  };

  console.log("[CURATOR/API] response_ok", {
    traceId,
    albumId: body.albumId,
    action: body.action,
    nextState,
    canonicalPath,
    afterCanonicalPath: afterSnapshot.canonical_cover_path ?? null,
    payload,
  });

  return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[CURATOR/API] unhandled_error", { traceId, error: msg, stack });
    return NextResponse.json({ ok: false, error: `unhandled:${msg}`, traceId }, { status: 500 });
  }
}
