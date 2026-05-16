import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { getCanonicalArtworkOverrides, resolveLocalFirstCanonicalCover } from "@/lib/canonical-artwork-overrides";
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

  return {
    kind: "album",
    albumId: id,
    title: (d.identity.album ?? "").trim() || "—",
    artist: (d.identity.artist ?? "").trim() || "—",
    year: typeof d.identity.chart_year === "number" ? d.identity.chart_year : null,
    canonicalCoverPath: cover.path?.trim() || null,
    canonicalCoverCacheBust: cover.cacheBust,
    trustState: cover.trustState ?? "unresolved",
  };
}
