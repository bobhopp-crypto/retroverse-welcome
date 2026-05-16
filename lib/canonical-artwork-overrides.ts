import { readFileSync } from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { cache } from "react";

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

async function putCanonicalArtworkOverridesToR2(file: CanonicalArtworkOverridesFile): Promise<void> {
  const client = getR2Client();
  await client.send(
    new PutObjectCommand({
      Bucket: r2Bucket(),
      Key: CANONICAL_ARTWORK_OVERRIDES_R2_KEY,
      Body: `${JSON.stringify(file, null, 2)}\n`,
      ContentType: "application/json",
      CacheControl: "max-age=0, must-revalidate",
    }),
  );
}

/**
 * Resolve merged override JSON without Next cache — use for curator writes so concurrent reads aren't stale mid-merge.
 */
export async function loadCanonicalArtworkOverridesUncached(): Promise<CanonicalArtworkOverridesFile> {
  const use = useR2ForOverridePersistence();

  if (use) {
    const fromR2 = await fetchCanonicalArtworkOverridesFromR2();
    if (fromR2) return fromR2;

    /** First deploy before any save: hydrate from bundled repo file, then curator writes promote to R2. */
    try {
      return await readCanonicalArtworkOverridesFromDisk();
    } catch {
      return readCanonicalArtworkOverridesSync();
    }
  }

  return readCanonicalArtworkOverridesFromDisk();
}

/** Per-request memo + one R2/read per SSR tree; avoids `unstable_cache` size limits on large override maps. */
export const getCanonicalArtworkOverrides = cache(loadCanonicalArtworkOverridesUncached);

export async function pickCanonicalCoverPathForAlbum(albumId: string): Promise<string | null> {
  const { path } = await pickCanonicalCoverForAlbum(albumId);
  return path;
}

/** Path + cache-bust token for `<img>` / `canonicalCoverPathToUrl` after curator saves. */
export async function pickCanonicalCoverForAlbum(
  albumId: string,
): Promise<{ path: string | null; cacheBust: string | null }> {
  const id = albumId.trim().toUpperCase();
  const file = await getCanonicalArtworkOverrides();
  const albums = file.albums ?? {};

  if (Object.prototype.hasOwnProperty.call(albums, id)) {
    const o = albums[id];
    const v = o?.canonical_cover_path;
    if (v !== undefined) {
      const path = v == null ? null : String(v).trim() || null;
      const cacheBust =
        typeof o?.updated_at === "string" && o.updated_at.trim() ? o.updated_at.trim() : file.updated_at;
      return { path, cacheBust };
    }
  }
  const d = getAlbumDossier(id);
  const p = d?.identity.canonical_cover_path ?? null;
  return { path: p?.trim() || null, cacheBust: null };
}

function coerceCellTrust(raw: string | undefined): RetroscopeCellDTO["trustState"] {
  if (raw === "verified" || raw === "provisional") return raw;
  return "unresolved";
}

/** Merge curator/runtime overrides atop materialized RetroScope cells by RVAL album id. */
export async function mergeCanonicalArtworkOverridesIntoRetroscopeCells(
  cells: RetroscopeCellDTO[],
): Promise<RetroscopeCellDTO[]> {
  const file = await getCanonicalArtworkOverrides();
  const albums = file.albums ?? {};
  if (Object.keys(albums).length === 0) return cells;

  return cells.map((cell) => {
    const id = cell.albumId.trim().toUpperCase();
    if (!(id in albums)) return cell;
    const o = albums[id];
    if (!o) return cell;

    let nextCover = cell.canonicalCoverPath;
    if ("canonical_cover_path" in o) {
      nextCover =
        o.canonical_cover_path == null ? null : String(o.canonical_cover_path).trim() || null;
    }

    const nextTrust = o.trust_state != null ? coerceCellTrust(o.trust_state) : cell.trustState;

    const bust =
      typeof o.updated_at === "string" && o.updated_at.trim() ? o.updated_at.trim() : file.updated_at;

    return {
      ...cell,
      canonicalCoverPath: nextCover,
      canonicalCoverCacheBust: bust,
      trustState: nextTrust,
    };
  });
}

export async function writeCanonicalArtworkOverride(
  albumId: string,
  record: Omit<CanonicalArtworkOverrideRecord, "updated_at"> & { updated_at?: string },
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

  if (useR2ForOverridePersistence()) {
    await putCanonicalArtworkOverridesToR2(base);
  } else {
    const p = defaultPath();
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, serialized, "utf8");
  }

  const { invalidateAlbumRetroscopeDatasetCache } = await import("@/lib/load-album-retroscope-dataset");
  invalidateAlbumRetroscopeDatasetCache();
}
