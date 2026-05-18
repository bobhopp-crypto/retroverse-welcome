import { sanitizeSearchQuery } from "@/lib/corpus-search";
import { hrefForArtist } from "@/lib/retroverse-routes";

import { searchDossierAlbums, searchDossierArtists } from "./dossier-fallback";
import { searchHot100ChartWeeks, searchHot100Tracks } from "./hot100";
import { searchSupabaseAlbums, searchSupabaseArtists, searchSupabaseTracks } from "./supabase";
import type { HomeSearchPayload, HomeSearchTrack } from "./types";

export type { HomeSearchPayload } from "./types";
export type { HomeSearchTrack, HomeSearchAlbum, HomeSearchArtist, HomeSearchChart } from "./types";

function mergeTracks(corpus: HomeSearchTrack[], hot100: HomeSearchTrack[], limit: number): HomeSearchTrack[] {
  const seen = new Set<string>();
  const out: HomeSearchTrack[] = [];
  for (const row of [...corpus, ...hot100]) {
    const key = `${row.title.toLowerCase()}|${row.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function mergeAlbums(primary: HomeSearchPayload["albums"], fallback: HomeSearchPayload["albums"]): HomeSearchPayload["albums"] {
  const seen = new Set(primary.map((r) => r.href));
  const out = [...primary];
  for (const row of fallback) {
    if (seen.has(row.href)) continue;
    seen.add(row.href);
    out.push(row);
    if (out.length >= 6) break;
  }
  return out.slice(0, 6);
}

function mergeArtists(primary: HomeSearchPayload["artists"], fallback: HomeSearchPayload["artists"]): HomeSearchPayload["artists"] {
  const seen = new Set(primary.map((r) => r.href));
  const out = [...primary];
  for (const row of fallback) {
    if (seen.has(row.href)) continue;
    seen.add(row.href);
    out.push(row);
    if (out.length >= 6) break;
  }
  return out.slice(0, 6);
}

/** Artists implied by track/album hits (e.g. Thriller → Michael Jackson). */
function artistsFromEntityHits(
  tracks: HomeSearchPayload["tracks"],
  albums: HomeSearchPayload["albums"],
): HomeSearchPayload["artists"] {
  const seen = new Set<string>();
  const out: HomeSearchPayload["artists"] = [];
  for (const name of [...tracks.map((t) => t.artist), ...albums.map((a) => a.artist)]) {
    const trimmed = name?.trim();
    if (!trimmed || trimmed === "—" || trimmed.toLowerCase() === "unknown artist") continue;
    const href = hrefForArtist(null, trimmed);
    if (seen.has(href)) continue;
    seen.add(href);
    out.push({ kind: "artist", name: trimmed, href });
    if (out.length >= 6) break;
  }
  return out;
}

async function safeLoader<T>(loader: string, q: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[home-search:loader]", { loader, q, message });
    return fallback;
  }
}

export async function runHomeSearch(raw: string): Promise<HomeSearchPayload> {
  const q = sanitizeSearchQuery(raw);
  if (q.length < 2) {
    return { ok: true, q, tracks: [], albums: [], artists: [], charts: [] };
  }

  let incomplete = false;

  const [tracksSb, albumsSb, artistsSb] = await Promise.all([
    safeLoader("searchSupabaseTracks", q, () => searchSupabaseTracks(q), []),
    safeLoader("searchSupabaseAlbums", q, () => searchSupabaseAlbums(q), []),
    safeLoader("searchSupabaseArtists", q, () => searchSupabaseArtists(q), []),
  ]);

  const albumsFb = albumsSb.length === 0 ? searchDossierAlbums(q) : [];
  const artistsFb = artistsSb.length === 0 ? searchDossierArtists(q) : [];
  if (albumsSb.length === 0 && albumsFb.length > 0) incomplete = true;
  if (artistsSb.length === 0 && artistsFb.length > 0) incomplete = true;
  if (tracksSb.length === 0) incomplete = true;

  const albums = mergeAlbums(albumsSb, albumsFb);

  let hot100: HomeSearchTrack[] = [];
  try {
    hot100 = tracksSb.length < 4 ? searchHot100Tracks(q, 6 - tracksSb.length) : [];
  } catch (e) {
    console.warn("[home-search:loader]", { loader: "searchHot100Tracks", q, message: e instanceof Error ? e.message : String(e) });
    incomplete = true;
  }

  const tracks = mergeTracks(tracksSb, hot100, 6);
  const artists = mergeArtists(mergeArtists(artistsSb, artistsFb), artistsFromEntityHits(tracks, albums));

  let charts: HomeSearchPayload["charts"] = [];
  if (/\b(19|20)\d{2}\b/.test(q)) {
    try {
      charts = searchHot100ChartWeeks(q);
    } catch (e) {
      console.warn("[home-search:loader]", { loader: "searchHot100ChartWeeks", q, message: e instanceof Error ? e.message : String(e) });
    }
  }

  return { ok: true, q, tracks, albums, artists, charts, incomplete: incomplete || undefined };
}

export { normalizeHomeSearchPayload } from "./normalize-client";
