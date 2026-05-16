import { readFileSync } from "node:fs";
import path from "node:path";

import type { ArtistUniverseFile, ArtistUniverseIndexRow, ArtistUniverseRecord } from "@/lib/artist-universe-schema";
import { normalizeEntitySlug } from "@/lib/retroverse-routes";

let cached: ArtistUniverseFile | null = null;
let loadAttempted = false;

function defaultArtifactPath(): string {
  const env = process.env.ARTIST_UNIVERSE_PATH?.trim();
  if (env) return path.resolve(env);
  const fromRoot = process.env.RETROVERSE_DATA_ROOT?.trim()
    ? path.join(process.env.RETROVERSE_DATA_ROOT!.trim(), "runtime", "artist-universe.json")
    : "";
  const publicBundled = path.join(process.cwd(), "public", "data", "artists", "artist-universe.json");
  return fromRoot || publicBundled;
}

function loadBundle(): ArtistUniverseFile | null {
  if (loadAttempted) return cached;
  loadAttempted = true;
  const p = defaultArtifactPath();
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as ArtistUniverseFile;
    if (parsed?.version === 1 && parsed.artists_by_slug) {
      cached = parsed;
      return cached;
    }
  } catch {
    /* missing */
  }
  cached = null;
  return null;
}

export function getArtistUniverseBundle(): ArtistUniverseFile | null {
  return loadBundle();
}

export function listArtistUniverseIndex(opts?: { query?: string }): ArtistUniverseIndexRow[] {
  const bundle = loadBundle();
  if (!bundle) return [];
  const q = (opts?.query ?? "").trim().toLowerCase();
  if (!q) return bundle.index;
  return bundle.index.filter(
    (row) => row.display_name.toLowerCase().includes(q) || row.slug.includes(q),
  );
}

export function getArtistUniverseBySlug(slug: string): ArtistUniverseRecord | null {
  const bundle = loadBundle();
  if (!bundle) return null;
  const normalized = normalizeEntitySlug(slug);
  if (bundle.artists_by_slug[normalized]) return bundle.artists_by_slug[normalized]!;

  const viaId = bundle.artists_by_id[slug.toUpperCase()] ?? bundle.artists_by_id[slug];
  if (viaId) return bundle.artists_by_slug[viaId] ?? null;

  return null;
}

export function getArtistUniverseById(artistId: string): ArtistUniverseRecord | null {
  const bundle = loadBundle();
  if (!bundle) return null;
  const slug = bundle.artists_by_id[artistId.trim()] ?? bundle.artists_by_id[artistId.trim().toUpperCase()];
  if (!slug) return null;
  return bundle.artists_by_slug[slug] ?? null;
}
