export function normalizeEntitySlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const RE_CANONICAL_ALBUM_ID = /^RVAL\d{6}$/i;
const RE_CANONICAL_ARTIST_ID = /^RVAR\d{6}$/i;
const RE_CANONICAL_TRACK_ID = /^RVTR\d{6}$/i;

/** Prefer `/albums/RVAL######`; fallback to legacy title slug (`albumRoute`) when URL has no usable ID. */
export function hrefForAlbum(albumId: string | null | undefined, canonicalAlbumTitleFallback: string): string {
  const raw = typeof albumId === "string" ? albumId.trim() : "";
  const id = raw.toUpperCase();
  if (id && RE_CANONICAL_ALBUM_ID.test(id)) return `/albums/${id}`;
  const t = canonicalAlbumTitleFallback.trim();
  if (t) return albumRoute(t);
  return "/albums";
}

/** Prefer `/artists/RVAR######`; fallback to legacy name slug when URL has no usable ID. */
export function hrefForArtist(artistId: string | null | undefined, canonicalArtistNameFallback: string): string {
  const raw = typeof artistId === "string" ? artistId.trim() : "";
  const id = raw.toUpperCase();
  if (id && RE_CANONICAL_ARTIST_ID.test(id)) return `/artists/${id}`;
  const n = canonicalArtistNameFallback.trim();
  if (n) return artistRoute(n);
  return "/artists";
}

/** Prefer `/tracks/RVTR######`; safe list fallback only when unknown. */
export function hrefForTrack(trackId: string | null | undefined): string {
  const raw = typeof trackId === "string" ? trackId.trim() : "";
  const id = raw.toUpperCase();
  if (id && RE_CANONICAL_TRACK_ID.test(id)) return `/tracks/${id}`;
  return "/track-deck";
}

export function albumRoute(title: string): string {
  return `/albums/${normalizeEntitySlug(title)}`;
}

export function artistRoute(name: string): string {
  return `/artists/${normalizeEntitySlug(name)}`;
}
