import { getAlbumDossier } from "@/lib/load-album-dossier";
import { normalizeEntitySlug } from "@/lib/retroverse-routes";

export type ArtistIdentity = {
  artist_id: string;
  artist_name: string;
};

const GENERIC_ARTIST_SLUGS = new Set([
  "soundtrack",
  "original-soundtrack",
  "original-motion-picture-soundtrack",
  "motion-picture-soundtrack",
  "various-artists",
  "various",
  "compilation",
  "ost",
  "unknown-artist",
  "unknown",
]);

/** Billboard / materializer buckets that must not merge into one pseudo-artist. */
export function isGenericArtistBucket(artistName: string): boolean {
  const slug = normalizeEntitySlug(artistName);
  if (!slug) return true;
  if (GENERIC_ARTIST_SLUGS.has(slug)) return true;
  if (slug.endsWith("-soundtrack") && slug.length < 40) return true;
  return false;
}

export function artistSlugId(name: string): string {
  return `slug:${normalizeEntitySlug(name)}`;
}

/** Prefer dossier identity, then RetroScope cell string; skip generic buckets. */
export function resolveArtistIdentityForAlbum(
  albumId: string,
  cellArtistName: string | null | undefined,
): ArtistIdentity | null {
  const id = albumId.trim().toUpperCase();
  const dossier = getAlbumDossier(id);
  const dossierName = dossier?.identity.artist?.trim() ?? "";
  const cellName = cellArtistName?.trim() ?? "";

  const candidates = [dossierName, cellName].filter(Boolean);
  for (const name of candidates) {
    if (isGenericArtistBucket(name)) continue;
    return { artist_id: artistSlugId(name), artist_name: name };
  }
  return null;
}
