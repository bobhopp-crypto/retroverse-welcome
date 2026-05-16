import { unstable_cache } from "next/cache";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG } from "@/lib/canonical-artwork-overrides";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { createClient } from "@/lib/supabase";

const ID_CHUNK = 120;

function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

type AlbumCoreRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

function classifyTrustState(
  artworkStatus: string | null | undefined,
  canonicalCoverPath: string | null,
): DiscoverStableAlbumRow["trustState"] {
  const status = (artworkStatus ?? "").toLowerCase();
  if (
    !canonicalCoverPath ||
    status === "missing" ||
    status === "rejected" ||
    status === "low_confidence" ||
    status === "unresolved"
  ) {
    return "unresolved";
  }
  if (
    status === "pending" ||
    status === "needs_review" ||
    status === "provisional" ||
    status === "review_needed" ||
    status === "candidate"
  ) {
    return "provisional";
  }
  return "verified";
}

async function hydrateDiscoverAlbumRowsImpl(albumIds: string[]): Promise<DiscoverStableAlbumRow[]> {
  if (albumIds.length === 0) return [];
  const unique = [...new Set(albumIds)];
  const supabase = createClient();

  const { data: albumsResult, error: albumsError } = await supabase
    .from("retroverse_albums")
    .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
    .in("retroverse_album_id", unique);
  if (albumsError) throw albumsError;
  const albumById = new Map((albumsResult ?? []).map((row: AlbumCoreRow) => [row.retroverse_album_id, row]));

  const orderedAlbums: AlbumCoreRow[] = [];
  for (const id of albumIds) {
    const row = albumById.get(id);
    if (row) orderedAlbums.push(row);
  }

  const artistIds = [...new Set(orderedAlbums.map((a) => a.retroverse_artist_id))];
  const artistsById = new Map<string, string>();
  for (const idChunk of chunk(artistIds, ID_CHUNK)) {
    const part = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .in("retroverse_artist_id", idChunk);
    if (part.error) throw part.error;
    for (const row of (part.data ?? []) as ArtistRow[]) {
      artistsById.set(row.retroverse_artist_id, row.canonical_artist_name);
    }
  }

  const editionByAlbum = new Map<string, string>();
  for (const idChunk of chunk(unique, ID_CHUNK)) {
    const part = await supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_id", idChunk)
      .eq("is_primary", true);
    if (part.error) throw part.error;
    for (const row of (part.data ?? []) as EditionRow[]) {
      editionByAlbum.set(row.retroverse_album_id, row.retroverse_album_edition_id);
    }
  }

  const artworkAcc: Awaited<ReturnType<typeof loadAlbumArtworkRows>> = [];
  for (const idChunk of chunk(unique, ID_CHUNK)) {
    artworkAcc.push(...(await loadAlbumArtworkRows(supabase, idChunk)));
  }

  return orderedAlbums.map((album) => {
    const selected = selectCanonicalArtwork(artworkAcc, album.retroverse_album_id, editionByAlbum.get(album.retroverse_album_id) ?? null);
    const path = selected?.canonical_cover_path ?? null;
    const rawTitle =
      typeof album.canonical_album_title === "string" ? album.canonical_album_title : String(album.canonical_album_title ?? "");
    const title = rawTitle.trim();
    const resolvedArtistRaw = artistsById.get(album.retroverse_artist_id);
    const artist =
      resolvedArtistRaw != null && resolvedArtistRaw.trim().length > 0
        ? resolvedArtistRaw.trim()
        : "Unknown artist";

    return {
      kind: "album",
      albumId: album.retroverse_album_id,
      title,
      artist,
      year: album.release_year,
      canonicalCoverPath: path,
      trustState: classifyTrustState(selected?.artwork_status ?? null, path),
    };
  });
}

/**
 * Bypasses Next `unstable_cache` — use for curator surfaces where metadata freshness must win
 * (new album rows, repaired artist joins) over 120s TTL.
 */
export function hydrateDiscoverAlbumRowsFresh(albumIds: string[]): Promise<DiscoverStableAlbumRow[]> {
  if (albumIds.length === 0) return Promise.resolve([]);
  return hydrateDiscoverAlbumRowsImpl(albumIds);
}

/** Cache key preserves sequence so different windows do not collide. */
const hydrateCacheKey = (ids: string[]) => ids.join(",");

/**
 * Batched artwork + canonical cover resolution; cached briefly to avoid repeat resolver work.
 *
 * Tagged per-album so `revalidateTag("artwork:<albumId>")` from the save route
 * forces this batch to refetch on the next request that touches that album.
 */
export function hydrateDiscoverAlbumRows(albumIds: string[]): Promise<DiscoverStableAlbumRow[]> {
  if (albumIds.length === 0) return Promise.resolve([]);
  const key = hydrateCacheKey(albumIds);
  const tags = [
    "discover-hydrate-albums",
    CANONICAL_ARTWORK_OVERRIDES_CACHE_TAG,
    ...albumIds.map((id) => `artwork:${id}`),
  ];
  return unstable_cache(
    async () => hydrateDiscoverAlbumRowsImpl(albumIds),
    ["discover-hydrate-albums", key],
    { revalidate: 120, tags },
  )();
}
