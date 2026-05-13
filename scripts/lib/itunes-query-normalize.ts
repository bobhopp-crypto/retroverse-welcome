/**
 * Lightweight cleanup for iTunes **artist** queries and **album title** comparison keys.
 */

const TRAILING_EDITION_PATTERN =
  /(?:[-–—:]\s*|\s+)(?:super\s+deluxe|deluxe\s+edition|special\s+edition|collector'?s\s+edition|collectors\s+edition|expanded\s+edition|anniversary\s+edition|bonus\s+tracks?|deluxe|remaster(?:ed)?|expanded)(?:\s*edition)?\s*$/i;

function replaceFancyApostrophes(value: string): string {
  return value
    .replace(/\u2018|\u2019|\u201A|\u201B|\u2032|\u2035|\u0060|\u00B4/g, "'")
    .replace(/\u201C|\u201D|\u201E|\u201F/g, '"');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Remove stray punctuation clusters; keep letters, numbers, space, apostrophe, hyphen, &. */
function lightenPunctuation(value: string): string {
  let s = replaceFancyApostrophes(value);
  s = s.replace(/[!?]+/g, " ");
  s = s.replace(/[,;:]+/g, " ");
  s = s.replace(/[.]{2,}/g, " ");
  s = s.replace(/[""«»"""''`´]+/g, " ");
  s = s.replace(/[•·…]+/g, " ");
  return collapseWhitespace(s);
}

export function stripParentheticalsAndBrackets(value: string): string {
  let s = value;
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
  }
  return collapseWhitespace(s);
}

export function stripTrailingEditionSuffixes(value: string): string {
  let s = value;
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(TRAILING_EDITION_PATTERN, "").trim();
  }
  return collapseWhitespace(s);
}

/** Drop feat. / featuring / ft. and trailing guest clause. */
export function stripFeaturingClause(value: string): string {
  const idx = value.search(/\b(feat\.?|ft\.?|featuring)\b/i);
  if (idx < 0) return value.trim();
  let head = value.slice(0, idx).trim();
  head = head.replace(/[,;\-–—]\s*$/u, "").trim();
  return head;
}

/** Normalize & ↔ and for iTunes-style artist strings. */
export function normalizeAmpersand(value: string): string {
  return collapseWhitespace(value.replace(/\s*&\s*/g, " and "));
}

export function queryDedupeKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeArtistForItunesQuery(raw: string): string {
  let s = replaceFancyApostrophes(raw.trim());
  s = stripFeaturingClause(s);
  s = normalizeAmpersand(s);
  s = lightenPunctuation(s);
  return collapseWhitespace(s);
}

export function normalizeAlbumForItunesQuery(raw: string): string {
  let s = replaceFancyApostrophes(raw.trim());
  s = stripParentheticalsAndBrackets(s);
  s = stripTrailingEditionSuffixes(s);
  s = lightenPunctuation(s);
  return collapseWhitespace(s);
}

/** Lowercase key for fuzzy album title matching (Billboard vs iTunes catalog). */
export function normalizedAlbumComparisonKey(title: string): string {
  return normalizeAlbumForItunesQuery(title).toLowerCase();
}

/**
 * Collapses punctuation / dash runs so near-identical titles match across `--` vs `:` vs `–`.
 * For candidate ranking only (canonical comparison still uses `normalizedAlbumComparisonKey`).
 */
export function albumKeyForNearExactMatch(title: string): string {
  let s = normalizeAlbumForItunesQuery(title).toLowerCase();
  s = s.replace(/\s*--+\s*/g, " ");
  s = s.replace(/\s*[-–—]+\s*/g, " ");
  s = s.replace(/\s*:\s*/g, " ");
  return collapseWhitespace(s);
}

export type ArtistSearchAttempt = { level: "A" | "B"; query: string };

/**
 * Artist-first iTunes search variants (raw, then cleaned).
 */
export function buildArtistSearchAttempts(rawArtist: string): ArtistSearchAttempt[] {
  const a = collapseWhitespace(rawArtist);
  const ca = normalizeArtistForItunesQuery(a);
  const out: ArtistSearchAttempt[] = [];
  const seen = new Set<string>();
  const push = (level: ArtistSearchAttempt["level"], q: string) => {
    const k = queryDedupeKey(q);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ level, query: q });
  };
  push("A", a);
  push("B", ca);
  return out;
}
