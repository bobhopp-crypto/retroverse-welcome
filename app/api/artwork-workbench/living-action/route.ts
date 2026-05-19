import { randomUUID } from "node:crypto";
import path from "node:path";

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
import { ARTWORK_DEPLOY_ROOT, ARTWORK_ITUNES_PASS_ROOT } from "@/lib/artwork-storage-model";
import {
  ArtworkQualityWarning,
  buildDisplayUrl,
  fetchRemoteCoverBytes,
  isValidRvalAlbumId,
  normalizeRvalAlbumId,
  persistCoverBytes,
  readCoverBytesFromStaged,
} from "@/lib/curator-cover-persist";
import { curatorPipelineLog } from "@/lib/curator-pipeline-log";
import { getCuratorRuntimeStrategy, shouldUseLocalCanonicalDb } from "@/lib/curator-runtime-strategy";
import {
  insertCuratorActionLocal,
  preflightCanonicalArtworkLocalWrite,
  upsertCanonicalArtworkLocal,
  verifyCanonicalArtworkLocal,
} from "@/lib/local-canonical-curation";
import { logCuratorR2EnvPresence } from "@/lib/r2-client";
import { mirrorCanonicalArtworkToSupabase } from "@/lib/supabase-artwork-mirror";

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

type CuratorTimings = Record<string, number>;

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

function contentTypeForExtension(extension: string): string {
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return "image/jpeg";
}

async function deployStagedCover(
  albumId: string,
  stagedPath: string,
  traceId: string,
  allowUsableQuality: boolean,
  timings: CuratorTimings,
): ReturnType<typeof persistCoverBytes> {
  const extension = (path.extname(stagedPath) || ".jpg").toLowerCase();
  const fetchStart = performance.now();
  const bytes = await readCoverBytesFromStaged(stagedPath);
  timings.image_fetch = elapsedMs(fetchStart);
  return persistCoverBytes({
    albumId,
    bytes,
    contentType: contentTypeForExtension(extension),
    traceId,
    sourceUrl: stagedPath,
    allowUsableQuality,
  });
}

async function deployRemoteCover(
  albumId: string,
  remote: URL,
  traceId: string,
  allowUsableQuality: boolean,
  timings: CuratorTimings,
): ReturnType<typeof persistCoverBytes> {
  const fetchStart = performance.now();
  const bytes = await fetchRemoteCoverBytes(remote, traceId);
  timings.image_fetch = elapsedMs(fetchStart);
  const ext = path.extname(remote.pathname).toLowerCase();
  const extension = ext === ".png" || ext === ".webp" || ext === ".jpg" || ext === ".jpeg" ? ext : ".jpg";
  return persistCoverBytes({
    albumId,
    bytes,
    contentType: contentTypeForExtension(extension),
    traceId,
    sourceUrl: remote.toString(),
    allowUsableQuality,
  });
}

function saveFail(
  traceId: string,
  stage: string,
  message: string,
  detail?: string,
  status = 500,
) {
  return NextResponse.json({ ok: false, stage, message, detail: detail ?? message, traceId }, { status });
}

function curatorDebug(event: string, payload: Record<string, unknown>): void {
  if (process.env.NODE_ENV !== "production") {
    console.log(event, payload);
  }
}

function elapsedMs(start: number): number {
  return Math.round((performance.now() - start) * 10) / 10;
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
      curatorDebug("[CURATOR/REVALIDATE] tag_ok", { traceId, tag });
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
      curatorDebug("[CURATOR/REVALIDATE] path_ok", { traceId, path: p });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[CURATOR/REVALIDATE] path_failed", { traceId, path: p, error: msg });
    }
  }
}

export async function POST(request: Request) {
  const traceId = randomUUID().slice(0, 8);
  const ts = () => new Date().toISOString();
  const requestStart = performance.now();
  const timings: CuratorTimings = {};
  const timed = async <T,>(name: string, fn: () => Promise<T> | T): Promise<T> => {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      timings[name] = elapsedMs(start);
    }
  };

  logCuratorR2EnvPresence(traceId);

  curatorDebug("[CURATOR/API] request_received", {
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
    qualityOverride?: boolean | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    console.error("[CURATOR/API] request_json_parse_failed", { traceId, error: msg });
    return NextResponse.json({ ok: false, error: `invalid_json:${msg}`, traceId }, { status: 400 });
  }

  curatorDebug("[CURATOR/API] request_body", {
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

  const albumId = normalizeRvalAlbumId(body.albumId);
  body.albumId = albumId;

  if (!isValidRvalAlbumId(albumId)) {
    return saveFail(traceId, "validate", "invalid_rval_album_id", `Expected RVAL######, got ${albumId}`, 400);
  }

  const runtimeStrategy = getCuratorRuntimeStrategy();
  const localCanonicalDbEnabled = shouldUseLocalCanonicalDb();

  if (localCanonicalDbEnabled) {
    try {
      await timed("local_db_preflight", () => preflightCanonicalArtworkLocalWrite(albumId, traceId));
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      return saveFail(traceId, "local_db_preflight", msg, msg);
    }
  } else {
    curatorPipelineLog("local_db_preflight", {
      traceId,
      ok: true,
      skipped: true,
      runtimeStrategy,
      reason: "sqlite_disabled_for_serverless_public_runtime",
    });
  }

  try {

  const beforePath = await timed("before_cover_read", () => pickCanonicalCoverPathForAlbum(albumId));
  const beforeSnapshot = {
    retroverse_album_id: body.albumId,
    canonical_cover_path: beforePath,
    artwork_status: null as string | null,
  };

  curatorDebug("[CURATOR/API] before_local_cover", {
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

  let coverStorage: "local" | "r2" | null = null;
  let artworkQuality: Awaited<ReturnType<typeof persistCoverBytes>>["quality"] | null = null;
  if (body.action === "approve" || body.action === "replace_artwork") {
    const stagedPath = allowedStagedPath(body.stagedFilePath);
    const remote = allowedRemoteImage(body.candidateImageUrl ?? null);
    curatorDebug("[CURATOR/API] deploy_source_resolved", {
      traceId,
      hasStagedPath: Boolean(stagedPath),
      hasRemote: Boolean(remote),
      remoteHost: remote ? remote.host : null,
      remotePathPreview: remote ? remote.pathname.slice(0, 120) : null,
    });
    if (!stagedPath && !remote) {
      console.warn("[CURATOR/API] reject_missing_valid_replace_source", { traceId });
      return saveFail(traceId, "source", "missing_valid_replace_source", undefined, 400);
    }
    curatorDebug("[CURATOR/API] deploy_start", {
      traceId,
      mode: stagedPath ? "staged" : "remote",
    });
    let deployed;
    try {
      deployed = stagedPath
        ? await timed("critical_cover_persist_total", () =>
            deployStagedCover(body.albumId, stagedPath, traceId, body.qualityOverride === true, timings),
          )
        : await timed("critical_cover_persist_total", () =>
            deployRemoteCover(body.albumId, remote as URL, traceId, body.qualityOverride === true, timings),
          );
    } catch (e) {
      if (e instanceof ArtworkQualityWarning) {
        return NextResponse.json(
          {
            ok: false,
            stage: "artwork_quality_warning",
            message: e.quality.message,
            detail: `${e.quality.width}x${e.quality.height}, ${e.quality.byteSize} bytes. Preferred minimum is ${e.quality.thresholds.archiveMinDimension}px; usable minimum is ${e.quality.thresholds.usableMinDimension}px.`,
            traceId,
            artworkQuality: e.quality,
            retryWithQualityOverride: true,
          },
          { status: 409 },
        );
      }
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[CURATOR/API] image_persist_failed", { traceId, error: msg });
      if (
        msg.includes("image_unusable_thumbnail") ||
        msg.includes("image_unreadable_or_corrupt") ||
        msg.includes("unsupported_image_format")
      ) {
        return saveFail(traceId, "artwork_quality", msg, msg, 400);
      }
      return saveFail(traceId, "image_persist", msg, msg);
    }
    canonicalPath = deployed.canonicalPath;
    coverStorage = deployed.storage;
    artworkQuality = deployed.quality;
    Object.assign(timings, deployed.timings);
    curatorDebug("[CURATOR/API] cover_persisted", {
      traceId,
      canonicalPath,
      storage: coverStorage,
    });
  }
  if (body.action === "clear_artwork") canonicalPath = null;

  const status = statusForState(nextState);

  const sourceUrl =
    typeof body.candidateImageUrl === "string" && body.candidateImageUrl.trim()
      ? body.candidateImageUrl.trim()
      : typeof body.candidateSource === "string" && body.candidateSource.trim()
        ? body.candidateSource.trim()
        : null;
  const approvedAt =
    body.action === "approve" ||
    body.action === "mark_verified" ||
    nextState === "canonical_verified" ||
    nextState === "manually_corrected"
      ? new Date().toISOString()
      : null;

  let localDbVerified = false;
  if (localCanonicalDbEnabled) {
    try {
      await timed("local_db_write_verify", () => {
        insertCuratorActionLocal({
          albumId,
          actionType: body.action,
          previousValue: beforeSnapshot,
          newValue: {
            canonical_cover_path: canonicalPath,
            artwork_status: status,
            next_state: nextState,
          },
          clientInfo: JSON.stringify({
            traceId,
            replaceSource: body.replaceSource ?? null,
            userAgent: request.headers.get("user-agent"),
          }),
          traceId,
        });
        upsertCanonicalArtworkLocal({
          albumId,
          canonicalCoverPath: canonicalPath,
          sourceUrl,
          sourceType: body.replaceSource ?? sourceTag,
          curatorNotes: notes,
          approvedAt,
          traceId,
        });
        const localVerify = verifyCanonicalArtworkLocal(albumId, canonicalPath, traceId);
        if (!localVerify.ok) {
          throw new Error(localVerify.error);
        }
        localDbVerified = true;
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.error("[CURATOR/API] local_db_write_failed", { traceId, error: msg });
      return saveFail(traceId, "local_db_write", msg, msg);
    }
  } else {
    curatorPipelineLog("local_db_write", {
      traceId,
      ok: true,
      skipped: true,
      runtimeStrategy,
      reason: "sqlite_disabled_for_serverless_public_runtime",
      canonicalCoverPath: canonicalPath,
    });
  }

  const savedAt = Date.now();
  const displayUrl = buildDisplayUrl(canonicalPath, savedAt, coverStorage ?? undefined);
  if (canonicalPath && !displayUrl) {
    return saveFail(
      traceId,
      "display_url",
      "could_not_build_display_url",
      `path=${canonicalPath}`,
    );
  }

  const afterSnapshot = {
    retroverse_album_id: body.albumId,
    /** Authoritative in-process value after write — do not re-pick here (would hit stale per-request memo). */
    canonical_cover_path: canonicalPath,
    artwork_status: statusForState(nextState),
  };

  const runDeferredSync = async () => {
    const backgroundStart = performance.now();
    const backgroundTimings: CuratorTimings = {};
    const backgroundTimed = async <T,>(name: string, fn: () => Promise<T> | T): Promise<T> => {
      const start = performance.now();
      try {
        return await fn();
      } finally {
        backgroundTimings[name] = elapsedMs(start);
      }
    };

    try {
      await backgroundTimed("overrides_projection_write", () =>
        writeCanonicalArtworkOverride(
          body.albumId,
          {
            canonical_cover_path: canonicalPath,
            artwork_status: status,
            trust_state: discoverTrustForLivingState(nextState),
            cover_source: sourceTag,
          },
          traceId,
        ),
      );
      curatorPipelineLog("overrides_write", { traceId, ok: true, albumId, canonicalPath });
      curatorDebug("[CURATOR/API] canonical_overrides_written", {
        traceId,
        canonicalPath,
        artwork_status: status,
      });
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn("[CURATOR/API] override_write_failed_nonfatal", { traceId, error: msg });
    }

    try {
      const mirror = await backgroundTimed("supabase_mirror", () =>
        mirrorCanonicalArtworkToSupabase({
          traceId,
          albumId,
          canonicalCoverPath: canonicalPath,
          artworkStatus: status,
          coverSource: sourceTag,
          notes,
        }),
      );
      if (!mirror.ok && !("skipped" in mirror && mirror.skipped)) {
        console.warn("[CURATOR/API] supabase_mirror_failed_nonfatal", {
          traceId,
          albumId,
          error: mirror.error,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn("[CURATOR/API] supabase_mirror_failed_nonfatal", { traceId, albumId, error: msg });
    }

    try {
      await backgroundTimed("revalidate_cache", () => runRevalidate(traceId, body.albumId));
      curatorPipelineLog("cache_invalidate", { traceId, ok: true, albumId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[CURATOR/API] revalidate_failed_nonfatal", { traceId, error: msg });
    }

    let registry: Awaited<ReturnType<typeof loadArtworkStateRegistry>> | null = null;
    try {
      registry = await backgroundTimed("registry_load", () => loadArtworkStateRegistry());
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn("[CURATOR/API] artwork_state_registry_load_failed_nonfatal", { traceId, error: msg });
    }

    if (registry) {
      try {
        await backgroundTimed("registry_update_save", async () => {
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
          notes: `${notes}; storage=${coverStorage ?? "n/a"}`,
          dbSnapshotBefore: beforeSnapshot as Record<string, unknown> | null,
          dbSnapshotAfter: afterSnapshot as Record<string, unknown> | null,
        });
        await saveArtworkStateRegistry(registry);
      });
        curatorDebug("[CURATOR/API] artwork_state_registry_saved", {
          traceId,
          skippedInProduction: process.env.NODE_ENV === "production",
        });
      } catch (e) {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.warn("[CURATOR/API] artwork_state_registry_failed_nonfatal", { traceId, error: msg });
      }
    }

    console.info("[CURATOR/TIMING/BACKGROUND]", {
      traceId,
      albumId,
      timings: {
        ...backgroundTimings,
        backgroundTotal: elapsedMs(backgroundStart),
      },
    });
  };

  setTimeout(() => {
    void runDeferredSync().catch((e) => {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      console.warn("[CURATOR/API] deferred_sync_failed_nonfatal", { traceId, albumId, error: msg });
    });
  }, 0);

  const payload = {
    ok: true as const,
    albumId,
    action: body.action,
    nextState,
    canonicalPath,
    canonicalCoverPath: canonicalPath,
    displayUrl,
    publicCoverUrl: displayUrl,
    storage: coverStorage,
    artworkQuality,
    localDbVerified,
    localCanonicalDbEnabled,
    runtimeStrategy,
    backgroundSyncQueued: true,
    timings: {
      ...timings,
      responseTotal: elapsedMs(requestStart),
    },
    savedAt,
    traceId,
  };

  curatorDebug("[CURATOR/API] response_ok", {
    traceId,
    albumId: body.albumId,
    action: body.action,
    nextState,
    canonicalPath,
    afterCanonicalPath: afterSnapshot.canonical_cover_path ?? null,
    payload,
  });
  console.info("[CURATOR/TIMING]", { traceId, albumId, timings: payload.timings });

  return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error("[CURATOR/API] unhandled_error", { traceId, error: msg, stack });
    return NextResponse.json({ ok: false, error: `unhandled:${msg}`, traceId }, { status: 500 });
  }
}
