import { ilikePattern, sanitizeSearchQuery } from "@/lib/corpus-search";
import {
  searchCanonicalTracksByArtist,
  searchCanonicalTracksByTitle,
} from "@/lib/load-canonical-track-graph";
import { hrefForAlbum, hrefForArtist, hrefForTrack } from "@/lib/retroverse-routes";
import { tryCreateClient } from "@/lib/supabase";

import {
  filterSearchAlbums,
  filterSearchArtists,
  filterSearchTracks,
  type PrimaryCanonicalArtist,
} from "./corpus-filters";
import { finalizeArtistFirstTracks, mapGraphTracksToSearch } from "./graph-tracks";
import { sortByMatchScore, textMatchScore } from "./rank";
import { HOME_SEARCH_PANEL_LIMIT } from "./limits";
import { isHomeSearchSupabaseSkipped, recordHomeSearchSupabaseFailure } from "./supabase-gate";
import { withSearchTimeout } from "./timeout";
import type { HomeSearchAlbum, HomeSearchArtist, HomeSearchTrack } from "./types";

/** Fail fast when PostgREST is unhealthy — graph/dossier carry search. */
const SB_TIMEOUT_MS = 700;
const TRACK_LIMIT = HOME_SEARCH_PANEL_LIMIT;
const ALBUM_LIMIT = HOME_SEARCH_PANEL_LIMIT;
const ARTIST_LIMIT = HOME_SEARCH_PANEL_LIMIT;

function logSearchLoaderError(loader: string, q: string, err: unknown, field?: string): void {
  const message =
    err instanceof Error
      ? err.message
      : typeof err === "object" && err !== null && "message" in err
        ? String((err as { message: unknown }).message)
        : JSON.stringify(err);
  console.warn("[home-search]", { loader, q, field: field ?? null, message });
  recordHomeSearchSupabaseFailure(err);
}

function skipSupabase(): boolean {
  return isHomeSearchSupabaseSkipped();
}

/** Exact / strong name match for artist-first (bypasses broad ilike noise). */
export async function searchSupabaseArtistExact(q: string): Promise<PrimaryCanonicalArtist | null> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return null;

  if (skipSupabase()) return null;

  return withSearchTimeout(
    (async () => {
      try {
        const supabase = tryCreateClient();
        if (!supabase) return null;

        const { data, error } = await supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .ilike("canonical_artist_name", needle)
          .limit(8);
        if (error) {
          logSearchLoaderError("searchSupabaseArtistExact", q, error, "retroverse_artists");
          return null;
        }
        if (!data?.length) return null;

        const rows = data.map((a) => ({
          kind: "artist" as const,
          name: (a.canonical_artist_name ?? "—").trim(),
          href: hrefForArtist(a.retroverse_artist_id, a.canonical_artist_name ?? ""),
        }));

        const ranked = filterSearchArtists(
          rows.filter((r) => textMatchScore(r.name, needle) <= 2),
        );
        const best = ranked[0];
        if (!best) return null;

        const artistId = best.href.match(/RVAR\d{6}/i)?.[0]?.toUpperCase();
        if (!artistId) return null;

        return { name: best.name, href: best.href, artistId };
      } catch (e) {
        logSearchLoaderError("searchSupabaseArtistExact", q, e);
        return null;
      }
    })(),
    SB_TIMEOUT_MS,
    null,
  );
}

/** Tracks for a canonical artist: graph first, then Supabase title hits filtered by artist. */
export async function searchTracksForCanonicalArtistName(
  artistName: string,
  q: string,
): Promise<HomeSearchTrack[]> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return [];

  try {
    const graphMatches = await searchCanonicalTracksByArtist(artistName, TRACK_LIMIT);
    if (graphMatches.length) {
      return finalizeArtistFirstTracks(mapGraphTracksToSearch(graphMatches), TRACK_LIMIT);
    }

    if (skipSupabase()) return [];

    const titleHits = await searchSupabaseTracks(q);
    return filterSearchTracks(
      titleHits.filter((row) => textMatchScore(row.artist, artistName) <= 2),
    );
  } catch (e) {
    logSearchLoaderError("searchTracksForCanonicalArtistName", q, e);
    return [];
  }
}

export async function searchSupabaseTracks(q: string): Promise<HomeSearchTrack[]> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return [];

  try {
    const graphMatches = await searchCanonicalTracksByTitle(needle, TRACK_LIMIT);
    if (graphMatches.length) {
      const rows = mapGraphTracksToSearch(graphMatches);
      return filterSearchTracks(sortByMatchScore(rows, needle, (r) => `${r.title} ${r.artist}`, TRACK_LIMIT));
    }
  } catch (e) {
    logSearchLoaderError("searchSupabaseTracks:graph", q, e);
  }

  if (skipSupabase()) return [];

  return withSearchTimeout(
    (async () => {
      try {
        const supabase = tryCreateClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("retroverse_tracks")
          .select("retroverse_track_id, canonical_title, retroverse_artist_id")
          .ilike("canonical_title", ilikePattern(needle))
          .limit(12);
        if (error) {
          logSearchLoaderError("searchSupabaseTracks", q, error, "retroverse_tracks");
          return [];
        }
        if (!data?.length) return [];

        const artistIds = [...new Set(data.map((t) => t.retroverse_artist_id).filter(Boolean))];
        const { data: artists, error: artistsError } =
          artistIds.length > 0
            ? await supabase
                .from("retroverse_artists")
                .select("retroverse_artist_id, canonical_artist_name")
                .in("retroverse_artist_id", artistIds)
            : { data: [], error: null };
        if (artistsError) {
          logSearchLoaderError("searchSupabaseTracks", q, artistsError, "retroverse_artists");
        }

        const artistById = new Map(
          (artists ?? []).map((a) => [a.retroverse_artist_id, (a.canonical_artist_name ?? "—").trim()]),
        );

        const seen = new Set<string>();
        const rows: HomeSearchTrack[] = [];
        for (const t of data) {
          const title = (t.canonical_title ?? "—").trim();
          const artist = artistById.get(t.retroverse_artist_id) ?? "—";
          const dedupeKey = `${artist.toLowerCase()}::${title.toLowerCase()}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          rows.push({
            kind: "track" as const,
            title,
            artist,
            href: hrefForTrack(t.retroverse_track_id),
            subtitle: null,
            relation: "TRACK",
          });
        }

        return filterSearchTracks(sortByMatchScore(rows, needle, (r) => `${r.title} ${r.artist}`, TRACK_LIMIT));
      } catch (e) {
        logSearchLoaderError("searchSupabaseTracks", q, e);
        return [];
      }
    })(),
    SB_TIMEOUT_MS,
    [],
  );
}

/** Artist-first track panel: canonical graph, then Supabase by RVAR id. */
export async function searchSupabaseTracksByArtistId(
  artistId: string,
  artistName: string,
  q: string,
): Promise<HomeSearchTrack[]> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2 || !artistId.trim()) return [];

  try {
    const graphMatches = await searchCanonicalTracksByArtist(artistName, TRACK_LIMIT);
    if (graphMatches.length) {
      return finalizeArtistFirstTracks(mapGraphTracksToSearch(graphMatches), TRACK_LIMIT);
    }
  } catch (e) {
    logSearchLoaderError("searchSupabaseTracksByArtistId:graph", q, e);
  }

  if (skipSupabase()) return [];

  return withSearchTimeout(
    (async () => {
      try {
        const supabase = tryCreateClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("retroverse_tracks")
          .select("retroverse_track_id, canonical_title, retroverse_artist_id")
          .eq("retroverse_artist_id", artistId.trim().toUpperCase())
          .limit(24);
        if (error) {
          logSearchLoaderError("searchSupabaseTracksByArtistId", q, error, "retroverse_tracks");
          return [];
        }
        if (!data?.length) return [];

        const seen = new Set<string>();
        const rows: HomeSearchTrack[] = [];
        for (const t of data) {
          const title = (t.canonical_title ?? "—").trim();
          const dedupeKey = title.toLowerCase();
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          rows.push({
            kind: "track" as const,
            title,
            artist: artistName,
            href: hrefForTrack(t.retroverse_track_id),
            subtitle: null,
            relation: "TRACK",
          });
        }

        return finalizeArtistFirstTracks(rows, TRACK_LIMIT);
      } catch (e) {
        logSearchLoaderError("searchSupabaseTracksByArtistId", q, e);
        return [];
      }
    })(),
    SB_TIMEOUT_MS,
    [],
  );
}

export async function searchSupabaseAlbums(q: string): Promise<HomeSearchAlbum[]> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return [];
  if (skipSupabase()) return [];

  return withSearchTimeout(
    (async () => {
      try {
        const supabase = tryCreateClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, release_year, retroverse_artist_id")
          .ilike("canonical_album_title", ilikePattern(needle))
          .limit(12);
        if (error) {
          logSearchLoaderError("searchSupabaseAlbums", q, error, "retroverse_albums");
          return [];
        }
        if (!data?.length) return [];

        const artistIds = [...new Set(data.map((a) => a.retroverse_artist_id).filter(Boolean))];
        const { data: artists, error: artistsError } =
          artistIds.length > 0
            ? await supabase
                .from("retroverse_artists")
                .select("retroverse_artist_id, canonical_artist_name")
                .in("retroverse_artist_id", artistIds)
            : { data: [], error: null };
        if (artistsError) {
          logSearchLoaderError("searchSupabaseAlbums", q, artistsError, "retroverse_artists");
        }

        const artistById = new Map(
          (artists ?? []).map((a) => [a.retroverse_artist_id, (a.canonical_artist_name ?? "—").trim()]),
        );

        const seen = new Set<string>();
        const rows: HomeSearchAlbum[] = [];
        for (const a of data) {
          const title = (a.canonical_album_title ?? "—").trim();
          const artist = artistById.get(a.retroverse_artist_id) ?? "—";
          const dedupeKey = `${artist.toLowerCase()}::${title.toLowerCase()}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          rows.push({
            kind: "album" as const,
            title,
            artist,
            year: a.release_year ?? null,
            href: hrefForAlbum(a.retroverse_album_id, a.canonical_album_title ?? ""),
            relation: "ALBUM",
          });
        }

        return filterSearchAlbums(sortByMatchScore(rows, needle, (r) => r.title, ALBUM_LIMIT));
      } catch (e) {
        logSearchLoaderError("searchSupabaseAlbums", q, e);
        return [];
      }
    })(),
    SB_TIMEOUT_MS,
    [],
  );
}

/** Artist-first album panel: all canonical albums for matched RVAR. */
export async function searchSupabaseAlbumsByArtistId(artistId: string, q: string): Promise<HomeSearchAlbum[]> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2 || !artistId.trim()) return [];
  if (skipSupabase()) return [];

  return withSearchTimeout(
    (async () => {
      try {
        const supabase = tryCreateClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, release_year, retroverse_artist_id")
          .eq("retroverse_artist_id", artistId.trim().toUpperCase())
          .order("release_year", { ascending: false, nullsFirst: false })
          .limit(12);
        if (error) {
          logSearchLoaderError("searchSupabaseAlbumsByArtistId", q, error, "retroverse_albums");
          return [];
        }
        if (!data?.length) return [];

        const { data: artistRow, error: artistError } = await supabase
          .from("retroverse_artists")
          .select("canonical_artist_name")
          .eq("retroverse_artist_id", artistId.trim().toUpperCase())
          .maybeSingle();
        if (artistError) {
          logSearchLoaderError("searchSupabaseAlbumsByArtistId", q, artistError, "retroverse_artists");
        }

        const artistName = (artistRow?.canonical_artist_name ?? "—").trim();

        const seen = new Set<string>();
        const rows: HomeSearchAlbum[] = [];
        for (const a of data) {
          const title = (a.canonical_album_title ?? "—").trim();
          const dedupeKey = title.toLowerCase();
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);
          rows.push({
            kind: "album" as const,
            title,
            artist: artistName,
            year: a.release_year ?? null,
            href: hrefForAlbum(a.retroverse_album_id, a.canonical_album_title ?? ""),
            relation: "ALBUM",
          });
        }

        const ranked = sortByMatchScore(rows, needle, (r) => r.title, ALBUM_LIMIT);
        return filterSearchAlbums(ranked.length > 0 ? ranked : rows.slice(0, ALBUM_LIMIT));
      } catch (e) {
        logSearchLoaderError("searchSupabaseAlbumsByArtistId", q, e);
        return [];
      }
    })(),
    SB_TIMEOUT_MS,
    [],
  );
}

export async function searchSupabaseArtists(q: string): Promise<HomeSearchArtist[]> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return [];
  if (skipSupabase()) return [];

  return withSearchTimeout(
    (async () => {
      try {
        const supabase = tryCreateClient();
        if (!supabase) return [];

        const { data, error } = await supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .ilike("canonical_artist_name", ilikePattern(needle))
          .limit(12);
        if (error) {
          logSearchLoaderError("searchSupabaseArtists", q, error, "retroverse_artists");
          return [];
        }
        if (!data?.length) return [];

        const rows = data.map((a) => ({
          kind: "artist" as const,
          name: (a.canonical_artist_name ?? "—").trim(),
          href: hrefForArtist(a.retroverse_artist_id, a.canonical_artist_name ?? ""),
        }));

        return filterSearchArtists(sortByMatchScore(rows, needle, (r) => r.name, ARTIST_LIMIT));
      } catch (e) {
        logSearchLoaderError("searchSupabaseArtists", q, e);
        return [];
      }
    })(),
    SB_TIMEOUT_MS,
    [],
  );
}
