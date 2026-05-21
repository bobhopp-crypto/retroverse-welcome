import { ilikePattern, sanitizeSearchQuery } from "@/lib/corpus-search";
import { searchCanonicalTracksByTitle } from "@/lib/load-canonical-track-graph";
import { hrefForAlbum, hrefForArtist, hrefForTrack } from "@/lib/retroverse-routes";
import { tryCreateClient } from "@/lib/supabase";

import { sortByMatchScore } from "./rank";
import { withSearchTimeout } from "./timeout";
import type { HomeSearchAlbum, HomeSearchArtist, HomeSearchRelation, HomeSearchTrack } from "./types";

function graphTrackRelation(hasHot100: boolean, hasVdjMedia: boolean): HomeSearchRelation {
  if (hasHot100) return "TRACK";
  if (hasVdjMedia) return "VDJ";
  return "TRACK";
}

function trackSubtitle(peak: number | null | undefined, weeks: number | null | undefined): string | null {
  const parts: string[] = [];
  if (peak != null && Number.isFinite(peak)) parts.push(`Peak #${peak}`);
  if (weeks != null && weeks > 0) parts.push(`${weeks} wks`);
  return parts.length ? parts.join(" · ") : null;
}

const SB_TIMEOUT_MS = 450;
const TRACK_LIMIT = 6;
const ALBUM_LIMIT = 6;
const ARTIST_LIMIT = 6;

function logSearchLoaderError(loader: string, q: string, err: unknown, field?: string): void {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[home-search]", { loader, q, field: field ?? null, message });
}

export async function searchSupabaseTracks(q: string): Promise<HomeSearchTrack[]> {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return [];

  return withSearchTimeout(
    (async () => {
      try {
        const graphMatches = await searchCanonicalTracksByTitle(needle, TRACK_LIMIT);
        if (graphMatches.length) {
          const rows = graphMatches.map((t) => ({
            kind: "track" as const,
            title: t.canonicalTitle,
            artist: t.canonicalArtistName ?? "—",
            href: hrefForTrack(t.retroverseTrackId ?? t.trackId),
            subtitle: trackSubtitle(t.peakHot100Position, t.chartWeeks),
            relation: graphTrackRelation(t.hasHot100, t.hasVdjMedia),
          }));
          return sortByMatchScore(rows, needle, (r) => `${r.title} ${r.artist}`, TRACK_LIMIT);
        }

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

        return sortByMatchScore(rows, needle, (r) => `${r.title} ${r.artist}`, TRACK_LIMIT);
      } catch (e) {
        logSearchLoaderError("searchSupabaseTracks", q, e);
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

        return sortByMatchScore(rows, needle, (r) => r.title, ALBUM_LIMIT);
      } catch (e) {
        logSearchLoaderError("searchSupabaseAlbums", q, e);
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

        return sortByMatchScore(rows, needle, (r) => r.name, ARTIST_LIMIT);
      } catch (e) {
        logSearchLoaderError("searchSupabaseArtists", q, e);
        return [];
      }
    })(),
    SB_TIMEOUT_MS,
    [],
  );
}
