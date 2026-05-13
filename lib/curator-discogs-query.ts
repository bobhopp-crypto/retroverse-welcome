/**
 * Retroverse curator → Discogs search string hygiene.
 *
 * Metadata chain for `DiscoverStableAlbumRow.title` / `artist` / `year`:
 * - hydrate: `hydrateDiscoverAlbumRowsImpl` in `lib/discover-hydrate-rows.ts`
 * - `title`  ← `retroverse_albums.canonical_album_title` (trim only)
 * - `artist` ← `retroverse_artists.canonical_artist_name` via album FK (or "Unknown artist")
 * - `year`   ← `retroverse_albums.release_year`
 * There is no OCR or cover-text parsing here; polluted titles come from DB imports or stale client cache.
 *
 * Discogs lookups should prefer a short storefront-style album string. This strips a small set of
 * common anthology/marketing tails that leak into `canonical_album_title` — it does NOT invent titles.
 */

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Narrow cleanup for Discogs `q=` only — UI still shows full `canonical_album_title`.
 */
export function sanitizeAlbumTitleForDiscogsLookup(raw: string): string {
  let s = collapseSpaces(raw);
  if (!s) return s;

  // "Album — Greatest Hits" / hyphen variants
  s = s.replace(/\s*[—–\-]\s*greatest\s+hits\b.*$/iu, "");
  // "Album (Greatest Hits …)"
  s = s.replace(/\s*\(\s*greatest\s+hits\b[^)]*\)/giu, "");
  // "Album [Greatest Hits …]"
  s = s.replace(/\s*\[\s*greatest\s+hits\b[^\]]*\]/giu, "");

  // Trailing anthology suffix without delimiter, e.g. "Spirit Greatest Hits Edition"
  s = s.replace(/\s+greatest\s+hits\b.*$/iu, "");

  return collapseSpaces(s);
}
