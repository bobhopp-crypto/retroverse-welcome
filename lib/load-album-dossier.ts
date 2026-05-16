import { readFileSync } from "node:fs";
import path from "node:path";

import type { AlbumDossier, AlbumDossierBundleFile } from "@/lib/album-dossier-schema";

let cached: AlbumDossierBundleFile | null = null;
let bundleLoadAttempted = false;

function loadBundle(): AlbumDossierBundleFile | null {
  if (bundleLoadAttempted) return cached;
  bundleLoadAttempted = true;

  const envPath = process.env.ALBUM_DOSSIERS_PATH?.trim();
  const fromRoot = process.env.RETROVERSE_DATA_ROOT?.trim()
    ? path.join(process.env.RETROVERSE_DATA_ROOT!.trim(), "runtime", "album-dossiers.json")
    : "";
  const publicBundled = path.join(process.cwd(), "public", "data", "albums", "album-dossiers.json");

  for (const p of [envPath, fromRoot, publicBundled]) {
    if (!p) continue;
    try {
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as AlbumDossierBundleFile;
      if (parsed?.dossiers && typeof parsed.dossiers === "object") {
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

/** Server-only: local dossier for `/albums/[albumId]` (no Supabase). */
export function getAlbumDossier(albumId: string): AlbumDossier | null {
  const id = albumId?.trim().toUpperCase();
  if (!id || !/^RVAL\d{6}$/.test(id)) return null;
  const bundle = loadBundle();
  if (!bundle) return null;
  return bundle.dossiers[id] ?? null;
}

export function getAlbumDossiersBundleOrNull(): AlbumDossierBundleFile | null {
  return loadBundle();
}
