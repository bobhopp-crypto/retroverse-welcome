import { sanitizeSearchQuery } from "@/lib/corpus-search";

import { textMatchScore } from "./rank";
import type { HomeSearchAlbum, HomeSearchArtist, HomeSearchTrack } from "./types";

const RE_RVAR = /^\/artists\/(RVAR\d{6})$/i;
const RE_RVAL = /^\/albums\/(RVAL\d{6})$/i;
const RE_RVTR = /^\/tracks\/(RVTR\d{6})$/i;

const JUNK_TITLE_WORDS =
  /\b(mix|remix|karaoke|instrumental|soundtrack|intro|outro|megamix|tribute|cover version)\b/i;

const JUNK_ARTIST_WORDS = /\b(soundtrack|karaoke|tribute|unknown)\b/i;

export type PrimaryCanonicalArtist = {
  name: string;
  href: string;
  /** Empty when resolved by name only (dossier / graph) without Supabase RVAR. */
  artistId: string;
};

export function parseRvarFromHref(href: string): string | null {
  const m = href.trim().match(RE_RVAR);
  return m ? m[1]!.toUpperCase() : null;
}

export function isCanonicalArtistHref(href: string): boolean {
  return RE_RVAR.test(href.trim());
}

export function isCanonicalAlbumHref(href: string): boolean {
  return RE_RVAL.test(href.trim());
}

export function isCanonicalTrackHref(href: string): boolean {
  return RE_RVTR.test(href.trim());
}

/** DJ/mix/soundtrack titles and obvious import garbage. */
export function isJunkTrackTitle(title: string): boolean {
  const t = title.trim();
  if (!t || t === "—") return true;
  if (t.length < 2) return true;
  if (JUNK_TITLE_WORDS.test(t)) return true;
  if (/^b\s+/i.test(t)) return true;
  if (/^b\s+'/i.test(t)) return true;
  const letters = (t.match(/[a-z]/gi) ?? []).length;
  if (letters < Math.min(3, t.length * 0.25)) return true;
  return false;
}

export function isJunkArtistName(name: string): boolean {
  const n = name.trim();
  if (!n || n === "—") return true;
  if (n.toLowerCase() === "unknown artist") return true;
  if (JUNK_ARTIST_WORDS.test(n)) return true;
  if (/^soundtrack[-\s]/i.test(n)) return true;
  if (/^b\s+'/i.test(n)) return true;
  return false;
}

export function filterSearchTracks(tracks: HomeSearchTrack[]): HomeSearchTrack[] {
  return tracks.filter(
    (row) =>
      !isJunkTrackTitle(row.title) &&
      !isJunkArtistName(row.artist) &&
      isCanonicalTrackHref(row.href),
  );
}

export function filterSearchArtists(artists: HomeSearchArtist[]): HomeSearchArtist[] {
  const seen = new Set<string>();
  const out: HomeSearchArtist[] = [];
  for (const row of artists) {
    if (isJunkArtistName(row.name)) continue;
    if (!isCanonicalArtistHref(row.href)) continue;
    const id = parseRvarFromHref(row.href);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(row);
  }
  return out;
}

export function filterSearchAlbums(albums: HomeSearchAlbum[]): HomeSearchAlbum[] {
  return albums.filter(
    (row) => !isJunkTrackTitle(row.title) && !isJunkArtistName(row.artist) && isCanonicalAlbumHref(row.href),
  );
}

/** Strong canonical artist match (exact, prefix, or all query tokens). */
export function pickPrimaryCanonicalArtist(
  artists: HomeSearchArtist[],
  rawQuery: string,
): PrimaryCanonicalArtist | null {
  const needle = sanitizeSearchQuery(rawQuery);
  if (needle.length < 2) return null;

  let best: { row: HomeSearchArtist; score: number } | null = null;
  for (const row of filterSearchArtists(artists)) {
    const score = textMatchScore(row.name, needle);
    if (score > 2) continue;
    if (!best || score < best.score) best = { row, score };
  }
  if (!best) return null;

  const artistId = parseRvarFromHref(best.row.href);
  if (!artistId) return null;

  return { name: best.row.name, href: best.row.href, artistId };
}

/** When query looks like an artist name, drop tracks by other artists (e.g. "Lady Madonna" by Beatles). */
export function filterTracksForArtistQueryIntent(tracks: HomeSearchTrack[], rawQuery: string): HomeSearchTrack[] {
  const needle = sanitizeSearchQuery(rawQuery);
  if (needle.length < 2) return tracks;
  if (needle.split(/\s+/).length > 4) return tracks;
  return tracks.filter((row) => textMatchScore(row.artist, needle) <= 2);
}

export function pickPrimaryArtistByNameOnly(
  artists: HomeSearchArtist[],
  rawQuery: string,
): PrimaryCanonicalArtist | null {
  const needle = sanitizeSearchQuery(rawQuery);
  if (needle.length < 2) return null;

  let best: { row: HomeSearchArtist; score: number } | null = null;
  for (const row of artists) {
    if (isJunkArtistName(row.name)) continue;
    const score = textMatchScore(row.name, needle);
    if (score > 2) continue;
    if (!best || score < best.score) best = { row, score };
  }
  if (!best) return null;

  const artistId = parseRvarFromHref(best.row.href) ?? "";
  return { name: best.row.name, href: best.row.href, artistId };
}
