import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import {
  getCanonicalArtworkOverrides,
  hasCanonicalArtworkOverride,
  resolveLocalFirstCanonicalCover,
} from "@/lib/canonical-artwork-overrides";
import { shouldUseLocalCanonicalDb } from "@/lib/curator-runtime-strategy";
import { readCanonicalArtworkLocal } from "@/lib/local-canonical-curation";
import { getAlbumDossier } from "@/lib/load-album-dossier";

/**
 * Hydrate curator row from dossier bundle + canonical artwork overlays (SQLite-era Supabase hydrate removed).
 */
export async function discoverStableAlbumRowFromLocalDossier(albumId: string): Promise<DiscoverStableAlbumRow | null> {
  const id = albumId.trim().toUpperCase();
  if (!/^RVAL\d{6}$/.test(id)) return null;
  const d = getAlbumDossier(id);
  if (!d) return null;

  const file = await getCanonicalArtworkOverrides();
  const cover = resolveLocalFirstCanonicalCover(id, file, null);
  let canonicalCoverPath = cover.path?.trim() || null;
  let canonicalCoverCacheBust = cover.cacheBust;
  if (shouldUseLocalCanonicalDb()) {
    try {
      const local = readCanonicalArtworkLocal(id);
      const localPath = local?.canonical_cover_path?.trim();
      const preferLocal =
        localPath &&
        (!hasCanonicalArtworkOverride(id, file) || localPath.startsWith("/retroverse/covers/"));
      if (preferLocal && localPath) {
        canonicalCoverPath = localPath;
        canonicalCoverCacheBust = local?.updated_at ?? canonicalCoverCacheBust;
      }
    } catch {
      /* local SQLite optional */
    }
  }

  return {
    kind: "album",
    albumId: id,
    title: (d.identity.album ?? "").trim() || "—",
    artist: (d.identity.artist ?? "").trim() || "—",
    year: typeof d.identity.chart_year === "number" ? d.identity.chart_year : null,
    canonicalCoverPath,
    canonicalCoverCacheBust,
    trustState: cover.trustState ?? "unresolved",
  };
}
