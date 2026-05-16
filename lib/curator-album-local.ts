import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { pickCanonicalCoverPathForAlbum, readCanonicalArtworkOverridesSync } from "@/lib/canonical-artwork-overrides";
import { getAlbumDossier } from "@/lib/load-album-dossier";

function dossierTrustToDiscover(ts: string | undefined): DiscoverStableAlbumRow["trustState"] {
  const s = (ts ?? "").toLowerCase();
  if (s === "verified") return "verified";
  if (s === "provisional") return "provisional";
  return "unresolved";
}

/**
 * Hydrate curator row from dossier bundle + canonical artwork overlays (SQLite-era Supabase hydrate removed).
 */
export function discoverStableAlbumRowFromLocalDossier(albumId: string): DiscoverStableAlbumRow | null {
  const id = albumId.trim().toUpperCase();
  if (!/^RVAL\d{6}$/.test(id)) return null;
  const d = getAlbumDossier(id);
  if (!d) return null;

  const overrides = readCanonicalArtworkOverridesSync().albums[id];
  const path = pickCanonicalCoverPathForAlbum(id);

  let trustState: DiscoverStableAlbumRow["trustState"] = dossierTrustToDiscover(d.identity.trust_state);
  if (
    overrides?.trust_state === "verified" ||
    overrides?.trust_state === "provisional" ||
    overrides?.trust_state === "unresolved"
  ) {
    trustState = overrides.trust_state;
  }

  return {
    kind: "album",
    albumId: id,
    title: (d.identity.album ?? "").trim() || "—",
    artist: (d.identity.artist ?? "").trim() || "—",
    year: typeof d.identity.chart_year === "number" ? d.identity.chart_year : null,
    canonicalCoverPath: path?.trim() || null,
    trustState,
  };
}
