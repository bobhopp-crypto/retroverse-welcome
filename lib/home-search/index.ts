import { sanitizeSearchQuery } from "@/lib/corpus-search";

import { attachCoverUrlsToSearchPayload } from "./attach-cover-urls";
import { buildArtistExpandedSearch, isArtistFirstSearchQuery } from "./expand-artist-universe";
import {
  filterSearchAlbums,
  filterSearchArtists,
  filterSearchTracks,
  filterTracksForArtistQueryIntent,
  pickPrimaryArtistByNameOnly,
  pickPrimaryCanonicalArtist,
  type PrimaryCanonicalArtist,
} from "./corpus-filters";
import { searchDossierAlbums, searchDossierArtists } from "./dossier-fallback";
import { searchHot100ChartWeeks, searchHot100Tracks } from "./hot100";
import { HOME_SEARCH_PANEL_LIMIT } from "./limits";
import { textMatchScore } from "./rank";
import { isHomeSearchSupabaseSkipped } from "./supabase-gate";
import {
  searchSupabaseAlbums,
  searchSupabaseAlbumsByArtistId,
  searchSupabaseArtistExact,
  searchSupabaseArtists,
  searchSupabaseTracks,
  searchSupabaseTracksByArtistId,
  searchTracksForCanonicalArtistName,
} from "./supabase";
import type { HomeSearchPayload, HomeSearchTrack } from "./types";

export type { HomeSearchPayload } from "./types";
export type { HomeSearchTrack, HomeSearchAlbum, HomeSearchArtist, HomeSearchChart } from "./types";

const PANEL_LIMIT = HOME_SEARCH_PANEL_LIMIT;

function trackDedupeKey(row: HomeSearchTrack): string {
  return `${row.title.toLowerCase()}|${row.artist.toLowerCase()}`;
}

function mergeTracks(corpus: HomeSearchTrack[], hot100: HomeSearchTrack[], limit: number): HomeSearchTrack[] {
  const seen = new Set<string>();
  const out: HomeSearchTrack[] = [];
  for (const row of [...corpus, ...hot100]) {
    const key = trackDedupeKey(row);
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
    if (out.length >= PANEL_LIMIT) break;
  }
  return filterSearchAlbums(out.slice(0, PANEL_LIMIT));
}

function mergeArtists(primary: HomeSearchPayload["artists"], fallback: HomeSearchPayload["artists"]): HomeSearchPayload["artists"] {
  const seen = new Set(primary.map((r) => r.href));
  const out = [...primary];
  for (const row of fallback) {
    if (seen.has(row.href)) continue;
    seen.add(row.href);
    out.push(row);
    if (out.length >= PANEL_LIMIT) break;
  }
  return filterSearchArtists(out.slice(0, PANEL_LIMIT));
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

function albumsForPrimary(
  q: string,
  primary: PrimaryCanonicalArtist,
  albumsSb: HomeSearchPayload["albums"],
): HomeSearchPayload["albums"] {
  if (albumsSb.length > 0) return filterSearchAlbums(albumsSb).slice(0, PANEL_LIMIT);

  let byArtist = searchDossierAlbums(q).filter((a) => textMatchScore(a.artist, primary.name) <= 2);
  if (!byArtist.length) {
    byArtist = searchDossierAlbums(primary.name).filter(
      (a) => textMatchScore(a.artist, primary.name) <= 2,
    );
  }
  return filterSearchAlbums(byArtist).slice(0, PANEL_LIMIT);
}

export async function runHomeSearch(raw: string): Promise<HomeSearchPayload> {
  const t0 = performance.now();
  const q = sanitizeSearchQuery(raw);
  if (q.length < 2) {
    return { ok: true, q, tracks: [], albums: [], artists: [], charts: [] };
  }

  let incomplete = false;

  const dossierArtists = searchDossierArtists(q);
  let primary: PrimaryCanonicalArtist | null = pickPrimaryArtistByNameOnly(dossierArtists, q);

  if (primary && isArtistFirstSearchQuery(q, primary)) {
    const expandedEarly = await buildArtistExpandedSearch(q, primary);
    if (expandedEarly) {
      const withCovers = attachCoverUrlsToSearchPayload(expandedEarly);
      if (process.env.HOME_SEARCH_TIMING === "1") {
        console.info("[home-search:timing]", {
          q,
          mode: "artist-expansion",
          ms: Math.round(performance.now() - t0),
          tracks: withCovers.tracks.length,
          albums: withCovers.albums.length,
          artists: withCovers.artists.length,
          charts: withCovers.charts.length,
          supabaseSkipped: true,
        });
      }
      return withCovers;
    }
  }

  let artistsSb: HomeSearchPayload["artists"] = [];
  if (!primary?.artistId && !isHomeSearchSupabaseSkipped()) {
    const [artistsResult, exactArtist] = await Promise.all([
      safeLoader("searchSupabaseArtists", q, () => searchSupabaseArtists(q), []),
      safeLoader("searchSupabaseArtistExact", q, () => searchSupabaseArtistExact(q), null),
    ]);
    artistsSb = artistsResult;
    if (!primary) {
      primary = pickPrimaryCanonicalArtist(artistsSb, q) ?? exactArtist ?? pickPrimaryArtistByNameOnly(dossierArtists, q);
    }
  } else if (!primary) {
    primary = pickPrimaryArtistByNameOnly(dossierArtists, q);
  }

  const tracksPromise = primary?.artistId
    ? safeLoader("searchSupabaseTracksByArtistId", q, () =>
        searchSupabaseTracksByArtistId(primary!.artistId, primary!.name, q),
      [],)
    : primary
      ? safeLoader("searchTracksForCanonicalArtistName", q, () =>
          searchTracksForCanonicalArtistName(primary.name, q),
        [],)
      : safeLoader("searchSupabaseTracks", q, () => searchSupabaseTracks(q), []);

  const albumsPromise = primary?.artistId
    ? safeLoader("searchSupabaseAlbumsByArtistId", q, () => searchSupabaseAlbumsByArtistId(primary.artistId, q), [])
    : primary
      ? Promise.resolve([] as HomeSearchPayload["albums"])
      : safeLoader("searchSupabaseAlbums", q, () => searchSupabaseAlbums(q), []);

  const [tracksSb, albumsSbRaw] = await Promise.all([tracksPromise, albumsPromise]);

  let albumsSb = primary
    ? albumsForPrimary(q, primary, albumsSbRaw)
    : filterSearchAlbums(albumsSbRaw).slice(0, PANEL_LIMIT);

  const albumsFb = !primary && albumsSb.length === 0 ? searchDossierAlbums(q) : [];
  const artistsFb = artistsSb.length === 0 ? dossierArtists : [];
  if (!primary && albumsSb.length === 0 && albumsFb.length > 0) incomplete = true;
  if (artistsSb.length === 0 && artistsFb.length > 0) incomplete = true;
  if (tracksSb.length === 0) incomplete = true;

  const albums = mergeAlbums(albumsSb, albumsFb);

  let hot100: HomeSearchTrack[] = [];
  if (!primary) {
    try {
      if (tracksSb.length < 4) {
        hot100 = filterSearchTracks(searchHot100Tracks(q, PANEL_LIMIT - tracksSb.length));
      }
    } catch (e) {
      console.warn("[home-search:loader]", {
        loader: "searchHot100Tracks",
        q,
        message: e instanceof Error ? e.message : String(e),
      });
      incomplete = true;
    }
  }

  let tracks = filterSearchTracks(mergeTracks(tracksSb, hot100, PANEL_LIMIT));
  if (!primary) {
    tracks = filterTracksForArtistQueryIntent(tracks, q);
  }

  let artists = mergeArtists(artistsSb, artistsFb);
  if (primary && !artists.some((a) => textMatchScore(a.name, q) <= 2)) {
    artists = [{ kind: "artist", name: primary.name, href: primary.href }, ...artists].slice(0, PANEL_LIMIT);
  }

  let charts: HomeSearchPayload["charts"] = [];
  if (/\b(19|20)\d{2}\b/.test(q)) {
    try {
      charts = searchHot100ChartWeeks(q);
    } catch (e) {
      console.warn("[home-search:loader]", {
        loader: "searchHot100ChartWeeks",
        q,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const base = { ok: true as const, q, tracks, albums, artists, charts, incomplete: incomplete || undefined };
  const withCovers = attachCoverUrlsToSearchPayload(base);

  if (process.env.HOME_SEARCH_TIMING === "1") {
    console.info("[home-search:timing]", {
      q,
      ms: Math.round(performance.now() - t0),
      tracks: withCovers.tracks.length,
      albums: withCovers.albums.length,
      artists: withCovers.artists.length,
      supabaseSkipped: isHomeSearchSupabaseSkipped(),
    });
  }

  return withCovers;
}

export { normalizeHomeSearchPayload } from "./normalize-client";
