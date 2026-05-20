import { readFileSync } from "node:fs";
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
let loadAttempted = false;

function loadSidecarMap(): Record<string, DossierMbSidecarAlbum> | null {
  if (loadAttempted) return cached;
  loadAttempted = true;

  const envPath = process.env.DOSSIER_MUSICBRAINZ_SIDECAR_PATH?.trim();
  const fromRoot = process.env.RETROVERSE_DATA_ROOT?.trim()
    ? path.join(process.env.RETROVERSE_DATA_ROOT.trim(), "runtime", "dossier-musicbrainz-by-rval.json")
    : "";
  const publicBundled = path.join(
    process.cwd(),
    "public",
    "data",
    "albums",
    "dossier-musicbrainz-by-rval.json",
  );

  for (const p of [envPath, fromRoot, publicBundled]) {
    if (!p) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as Record<string, DossierMbSidecarAlbum>;
      if (parsed && typeof parsed === "object") {
        cached = parsed;
        return cached;
      }
    } catch {
      /* try next */
    }
  }

  cached = null;
  return null;
}

/** Server-only: recovered MusicBrainz track order for an RVAL album. */
export function getDossierMusicBrainzSidecar(albumId: string): DossierMbSidecarAlbum | null {
  const id = albumId?.trim().toUpperCase();
  if (!id || !/^RVAL\d{6}$/.test(id)) return null;
  const map = loadSidecarMap();
  if (!map) return null;
  return map[id] ?? null;
}
