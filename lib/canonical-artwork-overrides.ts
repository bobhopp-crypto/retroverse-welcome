import { readFileSync } from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import type { RetroscopeCellDTO } from "@/lib/album-retroscope-constants";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import { getR2Client, r2Bucket } from "@/lib/r2-client";

export type CanonicalArtworkOverrideRecord = {
  canonical_cover_path: string | null;
  artwork_status?: string | null;
  trust_state?: "verified" | "provisional" | "unresolved";
  updated_at?: string;
  cover_source?: string | null;
};

export type CanonicalArtworkOverridesFile = {
  version: 1;
  updated_at: string;
  albums: Record<string, CanonicalArtworkOverrideRecord>;
};

/** Bucket key for merged override JSON (same bucket as canonical cover objects). */
export const CANONICAL_ARTWORK_OVERRIDES_R2_KEY = "retroverse/config/canonical-artwork-overrides.json";

/**
 * Tag for dependent `unstable_cache` payloads (Discover hydrate rows). Overrides themselves are not
 * stored in Next's persistent data cache — the JSON can be megabytes — so curator saves retain this
 * tag to invalidate dependents without risking cache serialization crashes.
 */
export const CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG = "canonical-artwork-overrides";

/** Warm-instance snapshot — updated synchronously on curator write so reads never lag R2/disk. */
let processOverridesSnapshot: CanonicalArtworkOverridesFile | null = null;

function defaultPath(): string {
  const env = process.env.CANONICAL_ARTWORK_OVERRIDES_PATH?.trim();
  if (env) return path.resolve(env);
  return path.join(process.cwd(), "public", "data", "albums", "canonical-artwork-overrides.json");
}

/**
 * Production: R2 blob is authoritative. Development: repo JSON under public/ unless forced.
 *
 * Override with CANONICAL_ARTWORK_OVERRIDES_USE_LOCAL_ONLY=1 on Vercel to fall back (emergency).
 */
function useR2ForOverridePersistence(): boolean {
  const forceLocal =
    typeof process.env.CANONICAL_ARTWORK_OVERRIDES_USE_LOCAL_ONLY === "string" &&
    process.env.CANONICAL_ARTWORK_OVERRIDES_USE_LOCAL_ONLY.trim() === "1";
  if (forceLocal) return false;
  const forceR2 =
    typeof process.env.CANONICAL_ARTWORK_OVERRIDES_USE_R2 === "string" &&
    process.env.CANONICAL_ARTWORK_OVERRIDES_USE_R2.trim() === "1";
  if (forceR2) return true;
  return process.env.NODE_ENV === "production";
}

function normalizedOverridesFromParsed(parsed: Partial<CanonicalArtworkOverridesFile> | null): CanonicalArtworkOverridesFile {
  if (
    parsed?.albums &&
    typeof parsed.albums === "object" &&
    (!parsed.version || parsed.version === 1)
  ) {
    return {
      version: 1,
      updated_at:
        typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
      albums: parsed.albums as Record<string, CanonicalArtworkOverrideRecord>,
    };
  }
  const now = new Date().toISOString();
  return { version: 1, updated_at: now, albums: {} };
}

/** Parse bundled / local-disk JSON — small and stable. */
export function readCanonicalArtworkOverridesSync(): CanonicalArtworkOverridesFile {
  const p = defaultPath();
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<CanonicalArtworkOverridesFile>;
    return normalizedOverridesFromParsed(parsed);
  } catch {
    const now = new Date().toISOString();
    return { version: 1, updated_at: now, albums: {} };
  }
}

async function readCanonicalArtworkOverridesFromDisk(): Promise<CanonicalArtworkOverridesFile> {
  const p = defaultPath();
  try {
    const raw = await readFile(p, "utf8");
    return normalizedOverridesFromParsed(JSON.parse(raw) as Partial<CanonicalArtworkOverridesFile>);
  } catch {
    return readCanonicalArtworkOverridesSync();
  }
}

function isR2NotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const meta = "$metadata" in err ? ((err as { $metadata?: { httpStatusCode?: number } }).$metadata ?? null) : null;
  if (meta?.httpStatusCode === 404) return true;
  const name = "name" in err && typeof (err as { name?: string }).name === "string"
    ? (err as { name: string }).name
    : "";
  return name === "NoSuchKey" || name === "NotFound";
}

async function fetchCanonicalArtworkOverridesFromR2(): Promise<CanonicalArtworkOverridesFile | null> {
  try {
    const client = getR2Client();
    const res = await client.send(
      new GetObjectCommand({ Bucket: r2Bucket(), Key: CANONICAL_ARTWORK_OVERRIDES_R2_KEY }),
    );
    const raw = await res.Body?.transformToString();
    if (raw == null || raw.trim() === "") return null;
    return normalizedOverridesFromParsed(JSON.parse(raw) as Partial<CanonicalArtworkOverridesFile>);
  } catch (e: unknown) {
    if (isR2NotFound(e)) return null;
    console.error("[canonical-artwork-overrides] R2 GET failed:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function putCanonicalArtworkOverridesToR2(
  file: CanonicalArtworkOverridesFile,
  traceId?: string,
): Promise<void> {
  const client = getR2Client();
  const bucket = r2Bucket();
  const key = CANONICAL_ARTWORK_OVERRIDES_R2_KEY;
  const body = `${JSON.stringify(file, null, 2)}\n`;
  console.log("[CURATOR/R2] overrides_put_start", {
    traceId: traceId ?? null,
    bucket,
    key,
    byteSize: body.length,
    albumCount: Object.keys(file.albums ?? {}).length,
  });
  const putRes = await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: "application/json",
      CacheControl: "max-age=0, must-revalidate",
    }),
  );
  console.log("[CURATOR/R2] overrides_put_done", {
    traceId: traceId ?? null,
    key,
    etag: putRes.ETag ?? null,
  });
  const { headR2Object } = await import("@/lib/r2-client");
  const head = await headR2Object({ key, traceId: traceId ?? "overrides" });
  console.log("[CURATOR/R2] overrides_head_verify", {
    traceId: traceId ?? null,
    key,
    headOk: head.ok,
    etag: head.ok ? head.etag : null,
    contentLength: head.ok ? head.contentLength : null,
    error: head.ok ? null : head.error,
  });
  if (!head.ok) {
    throw new Error(`overrides_r2_head_failed:${head.error}`);
  }
}

/**
 * Resolve merged override JSON without Next cache — use for curator writes so concurrent reads aren't stale mid-merge.
 */
export async function loadCanonicalArtworkOverridesUncached(): Promise<CanonicalArtworkOverridesFile> {
  if (processOverridesSnapshot) return processOverridesSnapshot;

  const use = useR2ForOverridePersistence();

  let loaded: CanonicalArtworkOverridesFile;
  if (use) {
    const fromR2 = await fetchCanonicalArtworkOverridesFromR2();
    if (fromR2) {
      loaded = fromR2;
    } else {
      /** First deploy before any save: hydrate from bundled repo file, then curator writes promote to R2. */
      try {
        loaded = await readCanonicalArtworkOverridesFromDisk();
      } catch {
        loaded = readCanonicalArtworkOverridesSync();
      }
    }
  } else {
    loaded = await readCanonicalArtworkOverridesFromDisk();
  }

  processOverridesSnapshot = loaded;
  return loaded;
}

/** One read per call site; backed by process snapshot after curator saves. */
export async function getCanonicalArtworkOverrides(): Promise<CanonicalArtworkOverridesFile> {
  return loadCanonicalArtworkOverridesUncached();
}

export type ResolvedCanonicalCover = {
  path: string | null;
  cacheBust: string | null;
  trustState: "verified" | "provisional" | "unresolved" | null;
};

/** Merge override JSON atop a fallback path (Supabase, dossier, coordinates file). */
export function resolveCanonicalCoverForAlbum(
  albumId: string,
  fallback: {
    path?: string | null;
    trustState?: "verified" | "provisional" | "unresolved" | null;
  },
  file: CanonicalArtworkOverridesFile,
): ResolvedCanonicalCover {
  const id = albumId.trim().toUpperCase();
  const albums = file.albums ?? {};
  let path = fallback.path?.trim() || null;
  let trustState = fallback.trustState ?? null;
  let cacheBust: string | null = null;

  if (Object.prototype.hasOwnProperty.call(albums, id)) {
    const o = albums[id];
    if (o && "canonical_cover_path" in o) {
      path = o.canonical_cover_path == null ? null : String(o.canonical_cover_path).trim() || null;
    }
    if (o?.trust_state === "verified" || o?.trust_state === "provisional" || o?.trust_state === "unresolved") {
      trustState = o.trust_state;
    }
    cacheBust =
      typeof o?.updated_at === "string" && o.updated_at.trim() ? o.updated_at.trim() : file.updated_at;
  }

  return { path, cacheBust, trustState };
}

export function hasCanonicalArtworkOverride(
  albumId: string,
  file: CanonicalArtworkOverridesFile,
): boolean {
  const id = albumId.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(file.albums ?? {}, id);
}

function dossierTrustForAlbum(albumId: string): "verified" | "provisional" | "unresolved" {
  const d = getAlbumDossier(albumId.trim().toUpperCase());
  const s = (d?.identity.trust_state ?? "").toLowerCase();
  if (s === "verified") return "verified";
  if (s === "provisional") return "provisional";
  return "unresolved";
}

export type SupabaseArtworkFallback = {
  canonical_cover_path: string | null;
  artwork_status?: string | null;
};

/** Trust from Supabase `retroverse_album_artwork.artwork_status` (fallback tier only). */
export function trustStateFromArtworkStatus(
  artworkStatus: string | null | undefined,
  canonicalCoverPath: string | null,
): "verified" | "provisional" | "unresolved" {
  const status = (artworkStatus ?? "").toLowerCase();
  if (
    !canonicalCoverPath ||
    status === "missing" ||
    status === "rejected" ||
    status === "low_confidence" ||
    status === "unresolved"
  ) {
    return "unresolved";
  }
  if (
    status === "pending" ||
    status === "needs_review" ||
    status === "provisional" ||
    status === "review_needed" ||
    status === "candidate"
  ) {
    return "provisional";
  }
  return "verified";
}

/**
 * Cover authority: overrides → dossier → optional Supabase artwork row.
 * Supabase is never consulted when an override exists or dossier supplies a path.
 */
export function resolveLocalFirstCanonicalCover(
  albumId: string,
  overridesFile: CanonicalArtworkOverridesFile,
  supabaseFallback?: SupabaseArtworkFallback | null,
): ResolvedCanonicalCover {
  const id = albumId.trim().toUpperCase();
  const d = getAlbumDossier(id);
  const dossierPath = d?.identity.canonical_cover_path?.trim() || null;
  const dossierTrust = dossierTrustForAlbum(id);

  if (hasCanonicalArtworkOverride(id, overridesFile)) {
    return resolveCanonicalCoverForAlbum(id, { path: dossierPath, trustState: dossierTrust }, overridesFile);
  }

  const fromDossier = resolveCanonicalCoverForAlbum(
    id,
    { path: dossierPath, trustState: dossierTrust },
    overridesFile,
  );
  if (fromDossier.path?.trim()) {
    return fromDossier;
  }

  if (supabaseFallback) {
    const path = supabaseFallback.canonical_cover_path?.trim() || null;
    return {
      path,
      cacheBust: null,
      trustState: trustStateFromArtworkStatus(supabaseFallback.artwork_status, path),
    };
  }

  return { path: null, cacheBust: null, trustState: fromDossier.trustState ?? dossierTrust };
}

export async function pickCanonicalCoverPathForAlbum(albumId: string): Promise<string | null> {
  const { path } = await pickCanonicalCoverForAlbum(albumId);
  return path;
}

/** Path + cache-bust token for `<img>` / `canonicalCoverPathToUrl` after curator saves. */
export async function pickCanonicalCoverForAlbum(
  albumId: string,
): Promise<{ path: string | null; cacheBust: string | null }> {
  const file = await getCanonicalArtworkOverrides();
  const resolved = resolveLocalFirstCanonicalCover(albumId, file, null);
  return { path: resolved.path, cacheBust: resolved.cacheBust };
}

function coerceCellTrust(raw: string | undefined): RetroscopeCellDTO["trustState"] {
  if (raw === "verified" || raw === "provisional") return raw;
  return "unresolved";
}

/** Merge curator/runtime overrides atop materialized RetroScope cells by RVAL album id. */
export async function mergeCanonicalArtworkOverridesIntoRetroscopeCells(
  cells: RetroscopeCellDTO[],
): Promise<RetroscopeCellDTO[]> {
  const file = await loadCanonicalArtworkOverridesUncached();
  const albums = file.albums ?? {};
  if (Object.keys(albums).length === 0) return cells;

  return cells.map((cell) => {
    const id = cell.albumId.trim().toUpperCase();
    const resolved = resolveCanonicalCoverForAlbum(
      id,
      { path: cell.canonicalCoverPath, trustState: cell.trustState },
      file,
    );
    if (!Object.prototype.hasOwnProperty.call(albums, id)) return cell;

    return {
      ...cell,
      canonicalCoverPath: resolved.path,
      canonicalCoverCacheBust: resolved.cacheBust,
      trustState: resolved.trustState != null ? coerceCellTrust(resolved.trustState) : cell.trustState,
    };
  });
}

export async function writeCanonicalArtworkOverride(
  albumId: string,
  record: Omit<CanonicalArtworkOverrideRecord, "updated_at"> & { updated_at?: string },
  traceId?: string,
): Promise<void> {
  const id = albumId.trim().toUpperCase();
  if (!/^RVAL\d{6}$/i.test(id)) throw new Error("invalid_rval_album_id");

  let base = await loadCanonicalArtworkOverridesUncached();

  const updated_at =
    typeof record.updated_at === "string" ? record.updated_at : new Date().toISOString();
  const prev = base.albums[id] ?? {};
  const next: CanonicalArtworkOverrideRecord = {
    ...prev,
    ...record,
    updated_at,
  };
  base.albums[id] = next;
  base.updated_at = updated_at;

  const serialized = `${JSON.stringify(base, null, 2)}\n`;

  processOverridesSnapshot = base;

  const useR2 = useR2ForOverridePersistence();
  console.log("[CURATOR/API] overrides_write_target", {
    traceId: traceId ?? null,
    albumId: id,
    useR2,
    canonical_cover_path: record.canonical_cover_path ?? null,
  });

  if (useR2) {
    await putCanonicalArtworkOverridesToR2(base, traceId);
  } else {
    const p = defaultPath();
    console.log("[CURATOR/API] overrides_write_disk", { traceId: traceId ?? null, path: p });
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, serialized, "utf8");
    console.log("[CURATOR/API] overrides_write_disk_done", { traceId: traceId ?? null, path: p });
  }

  console.log("[CURATOR/SUPABASE] artwork_row_update", {
    traceId: traceId ?? null,
    albumId: id,
    skipped: true,
    reason: "canonical authority is overrides JSON + R2; no Supabase artwork write in this path",
  });

  const { invalidateAlbumRetroscopeDatasetCache } = await import("@/lib/load-album-retroscope-dataset");
  invalidateAlbumRetroscopeDatasetCache();
  console.log("[CURATOR/API] retroscope_dataset_cache_invalidated", { traceId: traceId ?? null, albumId: id });
}
