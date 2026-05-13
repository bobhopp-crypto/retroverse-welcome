/**
 * Billboard 200 SQLite → Retroverse historical album identity.
 * Real chart-derived albums only: no Discover/synthetic title patterns.
 */

export const BILLBOARD200_SOURCE = "billboard_200_sqlite";

export const EXCLUDED_SYNTHETIC_TITLE_SUBSTRINGS = [
  "chart essentials",
  "greatest chart tracks",
  "memory cuts",
] as const;

/** Discover-only inferred album notes (existing DB rows); imports must not use these. */
export const EXCLUDED_INFERRED_NOTES_SNIPPETS = [
  "inferred acquisition-ready compilation from recurring chart tracks",
  "inferred anthology-style compilation from chart recurrence",
] as const;

export type BillboardAlbumType = "studio" | "soundtrack" | "compilation" | "live" | "ep" | "single" | "other";

export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizeSlug(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Display cleanup: trim, collapse whitespace; keep original casing for titles. */
export function normalizeDisplayName(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function albumIdentityKey(artist: string, album: string): string {
  return `${normalizeText(artist)}::${normalizeText(album)}`;
}

export function parseYearFromChartDate(dateStr: string | null | undefined): number | null {
  if (!dateStr || dateStr.length < 4) return null;
  const y = Number.parseInt(dateStr.slice(0, 4), 10);
  return Number.isFinite(y) && y >= 1800 && y <= 2100 ? y : null;
}

export function isExcludedSyntheticTitle(title: string): boolean {
  const t = title.toLowerCase();
  for (const sub of EXCLUDED_SYNTHETIC_TITLE_SUBSTRINGS) {
    if (t.includes(sub)) return true;
  }
  return false;
}

export function classifyHistoricalAlbum(artistRaw: string, albumRaw: string): {
  album_type: BillboardAlbumType;
  soundtrack_flag: boolean;
} {
  const artistN = normalizeText(artistRaw);
  const albumLc = albumRaw.toLowerCase();

  const soundtrackArtist =
    artistN === "soundtrack" ||
    artistN.includes("original cast") ||
    artistN.includes("original broadway cast") ||
    artistN.includes("original motion picture cast");

  const soundtrackTitle =
    /\bsoundtrack\b/.test(albumLc) ||
    /\bmotion picture\b/.test(albumLc) ||
    /\bost\b/.test(albumLc) ||
    /\(soundtrack\)/i.test(albumRaw);

  const soundtrack_flag = soundtrackArtist || soundtrackTitle;

  if (/\(live\)|\blive at the|\blive in |\blive from |\blive album\b/i.test(albumRaw)) {
    return { album_type: "live", soundtrack_flag: soundtrack_flag || false };
  }
  if (soundtrack_flag) {
    return { album_type: "soundtrack", soundtrack_flag: true };
  }
  if (
    /\bgreatest hits\b|\bbest of\b|\bvolume\s*\d+\b|\bvol\.\s*\d+\b|\banthology\b|\bcollection\b/i.test(albumLc)
  ) {
    return { album_type: "compilation", soundtrack_flag: false };
  }
  return { album_type: "studio", soundtrack_flag: false };
}

