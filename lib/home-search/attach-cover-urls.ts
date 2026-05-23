import {
  readCanonicalArtworkOverridesSync,
  resolveLocalFirstCanonicalCover,
  type ResolvedCanonicalCover,
} from "@/lib/canonical-artwork-overrides";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { getAlbumDossier } from "@/lib/load-album-dossier";

import { textMatchScore } from "./rank";
import type { HomeSearchAlbum, HomeSearchArtist, HomeSearchPayload, HomeSearchTrack } from "./types";

const RE_RVAL = /^RVAL\d{6}$/i;
const RE_RVAL_HREF = /\/albums\/(RVAL\d{6})/i;

function albumIdFromHref(href: string): string | null {
  const m = href.trim().match(RE_RVAL_HREF);
  return m ? m[1]!.toUpperCase() : null;
}

function coverUrlFromResolved(resolved: ResolvedCanonicalCover): string | null {
  return canonicalCoverPathToUrl(resolved.path, { cacheBust: resolved.cacheBust });
}

function buildAlbumCoverUrlMap(albumIds: string[]): Map<string, string | null> {
  const unique = [...new Set(albumIds.filter((id) => RE_RVAL.test(id)))];
  const out = new Map<string, string | null>();
  if (!unique.length) return out;

  const overrides = readCanonicalArtworkOverridesSync();

  for (const id of unique) {
    const dossierPath = getAlbumDossier(id)?.identity.canonical_cover_path?.trim() || null;
    const resolved = resolveLocalFirstCanonicalCover(id, overrides, null);
    if (resolved.path?.trim() || dossierPath) {
      out.set(id, coverUrlFromResolved(resolved));
    }
  }

  return out;
}

/** Reuse album art for tracks — avoids per-track graph album resolution in search. */
function trackCoverFromAlbums(track: HomeSearchTrack, albums: HomeSearchAlbum[]): string | null {
  const linkedId = track.linkedAlbumHref ? albumIdFromHref(track.linkedAlbumHref) : null;
  if (linkedId) {
    const linked = albums.find((a) => albumIdFromHref(a.href) === linkedId);
    if (linked?.coverUrl) return linked.coverUrl;
  }
  for (const album of albums) {
    if (!album.coverUrl) continue;
    if (textMatchScore(album.artist, track.artist) <= 2) {
      if (track.linkedAlbum && textMatchScore(album.title, track.linkedAlbum) <= 2) return album.coverUrl;
      if (!track.linkedAlbum) return album.coverUrl;
    }
  }
  return null;
}

function pickArtistCoverUrl(artist: HomeSearchArtist, albums: HomeSearchAlbum[]): string | null {
  for (const album of albums) {
    if (!album.coverUrl) continue;
    if (textMatchScore(album.artist, artist.name) <= 2) return album.coverUrl;
  }
  return null;
}

/** Fast cover URLs: sync overrides + dossier paths only (no Supabase artwork round-trip). */
export function attachCoverUrlsToSearchPayload(payload: HomeSearchPayload): HomeSearchPayload {
  const albumIds = payload.albums
    .map((row) => albumIdFromHref(row.href))
    .filter((id): id is string => Boolean(id));

  const coverByAlbum = buildAlbumCoverUrlMap(albumIds);

  const albums: HomeSearchAlbum[] = payload.albums.map((row) => {
    const albumId = albumIdFromHref(row.href);
    const coverUrl = albumId ? (coverByAlbum.get(albumId) ?? null) : null;
    return coverUrl ? { ...row, coverUrl } : row;
  });

  const tracks: HomeSearchTrack[] = payload.tracks.map((row) => {
    const coverUrl = trackCoverFromAlbums(row, albums);
    return coverUrl ? { ...row, coverUrl } : row;
  });

  const artists: HomeSearchArtist[] = payload.artists.map((row) => {
    const coverUrl = pickArtistCoverUrl(row, albums);
    return coverUrl ? { ...row, coverUrl } : row;
  });

  return { ...payload, albums, tracks, artists };
}
