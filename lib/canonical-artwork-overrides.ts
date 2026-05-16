import { readFileSync } from "node:fs";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import type { RetroscopeCellDTO } from "@/lib/album-retroscope-constants";
import { getAlbumDossier } from "@/lib/load-album-dossier";

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

function defaultPath(): string {
  const env = process.env.CANONICAL_ARTWORK_OVERRIDES_PATH?.trim();
  if (env) return path.resolve(env);
  return path.join(process.cwd(), "public", "data", "albums", "canonical-artwork-overrides.json");
}

/** Server-only synchronous read — small JSON beside dossiers/coordinates; no caching for freshness after curator saves. */
export function readCanonicalArtworkOverridesSync(): CanonicalArtworkOverridesFile {
  const p = defaultPath();
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<CanonicalArtworkOverridesFile>;
    if (
      parsed?.albums &&
      typeof parsed.albums === "object" &&
      (!parsed.version || parsed.version === 1)
    ) {
      return {
        version: 1,
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
        albums: parsed.albums as Record<string, CanonicalArtworkOverrideRecord>,
      };
    }
  } catch {
    /* missing or invalid → empty */
  }
  const now = new Date().toISOString();
  return { version: 1, updated_at: now, albums: {} };
}

export async function writeCanonicalArtworkOverride(
  albumId: string,
  record: Omit<CanonicalArtworkOverrideRecord, "updated_at"> & { updated_at?: string },
): Promise<void> {
  const id = albumId.trim().toUpperCase();
  if (!/^RVAL\d{6}$/i.test(id)) throw new Error("invalid_rval_album_id");

  const p = defaultPath();
  await mkdir(path.dirname(p), { recursive: true });

  let base: CanonicalArtworkOverridesFile;
  try {
    const raw = await readFile(p, "utf8");
    const parsed = JSON.parse(raw) as Partial<CanonicalArtworkOverridesFile>;
    base =
      parsed?.albums && typeof parsed.albums === "object"
        ? {
            version: 1,
            updated_at:
              typeof parsed.updated_at === "string" ? parsed.updated_at : new Date().toISOString(),
            albums: parsed.albums as Record<string, CanonicalArtworkOverrideRecord>,
          }
        : readCanonicalArtworkOverridesSync();
  } catch {
    base = readCanonicalArtworkOverridesSync();
  }

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

  await writeFile(p, `${JSON.stringify(base, null, 2)}\n`, "utf8");
}

function coerceCellTrust(raw: string | undefined): RetroscopeCellDTO["trustState"] {
  if (raw === "verified" || raw === "provisional") return raw;
  return "unresolved";
}

/** Merge local curator/runtime overrides atop materialized RetroScope cells by RVAL album id. */
export function mergeCanonicalArtworkOverridesIntoRetroscopeCells(
  cells: RetroscopeCellDTO[],
): RetroscopeCellDTO[] {
  const file = readCanonicalArtworkOverridesSync();
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
        o.canonical_cover_path == null
          ? null
          : String(o.canonical_cover_path).trim() || null;
    }

    const nextTrust = o.trust_state != null ? coerceCellTrust(o.trust_state) : cell.trustState;

    return {
      ...cell,
      canonicalCoverPath: nextCover,
      trustState: nextTrust,
    };
  });
}

export function pickCanonicalCoverPathForAlbum(albumId: string): string | null {
  const id = albumId.trim().toUpperCase();
  const albums = readCanonicalArtworkOverridesSync().albums ?? {};
  if (Object.prototype.hasOwnProperty.call(albums, id)) {
    const v = albums[id]?.canonical_cover_path;
    if (v !== undefined) {
      return v == null ? null : String(v).trim() || null;
    }
  }
  const d = getAlbumDossier(id);
  const p = d?.identity.canonical_cover_path ?? null;
  return p?.trim() || null;
}
