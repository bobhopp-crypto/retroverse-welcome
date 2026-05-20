import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type DossierMbSidecarTrack = {
  position: number;
  title: string;
  source?: string;
  confidence?: string;
};

export type DossierMbSidecarAlbum = {
  artist: string;
  album: string;
  normalized_artist?: string;
  normalized_album?: string;
  release_mbid?: string;
  musicbrainz?: Record<string, unknown>;
  tracks: DossierMbSidecarTrack[];
};

let cached: Record<string, DossierMbSidecarAlbum> | null = null;
let cachedPath: string | null = null;

function sidecarCandidatePaths(): string[] {
  const envPath = process.env.DOSSIER_MUSICBRAINZ_SIDECAR_PATH?.trim();
  const publicBundled = path.join(
    process.cwd(),
    "public",
    "data",
    "albums",
    "dossier-musicbrainz-by-rval.json",
  );
  const fromRoot = process.env.RETROVERSE_DATA_ROOT?.trim()
    ? path.join(process.env.RETROVERSE_DATA_ROOT.trim(), "runtime", "dossier-musicbrainz-by-rval.json")
    : "";

  // Prefer shipped public bundle (Vercel/prod); runtime path for local materialize loop.
  return [envPath, publicBundled, fromRoot].filter((p): p is string => Boolean(p));
}

function loadSidecarMap(): Record<string, DossierMbSidecarAlbum> | null {
  for (const p of sidecarCandidatePaths()) {
    if (cached && cachedPath === p) return cached;
    if (!existsSync(p)) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as Record<string, DossierMbSidecarAlbum>;
      if (parsed && typeof parsed === "object") {
        cached = parsed;
        cachedPath = p;
        return cached;
      }
    } catch (err) {
      console.error("[mb-sidecar] failed to load", p, err instanceof Error ? err.message : err);
    }
  }
  cached = null;
  cachedPath = null;
  return null;
}

/** Server-only: recovered MusicBrainz track order for an RVAL album. */
export function getDossierMusicBrainzSidecar(albumId: string): DossierMbSidecarAlbum | null {
  const id = albumId?.trim().toUpperCase();
  if (!id || !/^RVAL\d{6}$/.test(id)) return null;
  const map = loadSidecarMap();
  if (!map) return null;
  const row = map[id];
  if (!row?.tracks?.length) return null;
  return row;
}
