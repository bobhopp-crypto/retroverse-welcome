import type { ArtistYearPresence } from "@/lib/artist-year-ranking-schema";
import { artistRetroscopeKey } from "@/lib/artist-year-ranking-schema";
import {
  getArtistYearPresence,
  getArtistYearPresenceByRank,
  getArtistYearRanking,
} from "@/lib/load-artist-year-rankings";
import { hrefForArtist } from "@/lib/retroverse-routes";

/** Navigate to canonical artist profile (RVAR when known, else name slug). */
export function hrefForArtistYearPresence(row: Pick<ArtistYearPresence, "artist_id" | "artist_name">): string {
  return hrefForArtist(row.artist_id, row.artist_name);
}

/** Future RetroScope artist-layer coordinate (distinct from album `year:rank`). */
export function artistRankCoordinateKey(year: number, retroverseArtistRank: number): string {
  return artistRetroscopeKey(year, retroverseArtistRank);
}

export function lookupArtistAtYearRank(year: number, retroverseArtistRank: number): ArtistYearPresence | null {
  return getArtistYearPresenceByRank(year, retroverseArtistRank);
}

export function lookupArtistAtYear(year: number, artistId: string): ArtistYearPresence | null {
  return getArtistYearPresence(year, artistId);
}

/** RetroScope artist coordinate (`1977:A1`). */
export const artistCoordinateKey = artistRankCoordinateKey;

export function hrefForArtistCoordinate(year: number, retroverseArtistRank: number): string | null {
  const row = getArtistAtCoordinate(year, retroverseArtistRank);
  return row ? hrefForArtistYearPresence(row) : null;
}

export function getArtistAtCoordinate(year: number, retroverseArtistRank: number): ArtistYearPresence | null {
  return lookupArtistAtYearRank(year, retroverseArtistRank);
}

export function getArtistYearRankings(year: number): ArtistYearPresence[] {
  return getArtistYearRanking(year);
}
