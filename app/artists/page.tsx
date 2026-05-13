import type { Metadata } from "next";
import Link from "next/link";

import { CompactArtworkThumb } from "@/app/components/compact-artwork-thumb";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { artistRoute } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "Artists - Retroverse",
  description: "Canonical artist archive index.",
};
export const dynamic = "force-dynamic";

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type TrackMembershipRow = {
  retroverse_artist_id: string;
  retroverse_album_id: string | null;
};

type AlbumRoleRow = {
  retroverse_artist_id: string;
  retroverse_album_id: string;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  release_year: number | null;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type ArtistsPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function ArtistsIndexPage({ searchParams }: ArtistsPageProps) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const supabase = createClient();

  const artistsResult = await supabase
    .from("retroverse_artists")
    .select("retroverse_artist_id, canonical_artist_name")
    .order("canonical_artist_name", { ascending: true });
  if (artistsResult.error) throw artistsResult.error;

  const artistIds = ((artistsResult.data ?? []) as ArtistRow[]).map((row) => row.retroverse_artist_id);
  const [trackMembershipsResult, albumRolesResult] = await Promise.all([
    artistIds.length > 0
      ? supabase
          .from("retroverse_tracks")
          .select("retroverse_artist_id, retroverse_album_id")
          .in("retroverse_artist_id", artistIds)
      : Promise.resolve({ data: [], error: null }),
    artistIds.length > 0
      ? supabase
          .from("retroverse_album_artist_roles")
          .select("retroverse_artist_id, retroverse_album_id")
          .in("retroverse_artist_id", artistIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (trackMembershipsResult.error) throw trackMembershipsResult.error;
  if (albumRolesResult.error) throw albumRolesResult.error;

  const trackMemberships = (trackMembershipsResult.data ?? []) as TrackMembershipRow[];
  const albumRoles = (albumRolesResult.data ?? []) as AlbumRoleRow[];

  const trackCountByArtistId = new Map<string, number>();
  const albumIdsByArtistId = new Map<string, Set<string>>();
  const appearanceCountByArtistId = new Map<string, number>();
  for (const row of trackMemberships) {
    trackCountByArtistId.set(row.retroverse_artist_id, (trackCountByArtistId.get(row.retroverse_artist_id) ?? 0) + 1);
    if (row.retroverse_album_id) {
      const ids = albumIdsByArtistId.get(row.retroverse_artist_id) ?? new Set<string>();
      ids.add(row.retroverse_album_id);
      albumIdsByArtistId.set(row.retroverse_artist_id, ids);
    }
  }
  for (const row of albumRoles) {
    appearanceCountByArtistId.set(row.retroverse_artist_id, (appearanceCountByArtistId.get(row.retroverse_artist_id) ?? 0) + 1);
    const ids = albumIdsByArtistId.get(row.retroverse_artist_id) ?? new Set<string>();
    ids.add(row.retroverse_album_id);
    albumIdsByArtistId.set(row.retroverse_artist_id, ids);
  }

  const allAlbumIds = [...new Set([...albumIdsByArtistId.values()].flatMap((ids) => [...ids]))];
  const [albumsResult, editionsResult, artworkRows] = await Promise.all([
    allAlbumIds.length > 0
      ? supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, release_year")
          .in("retroverse_album_id", allAlbumIds)
      : Promise.resolve({ data: [], error: null }),
    allAlbumIds.length > 0
      ? supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id")
          .in("retroverse_album_id", allAlbumIds)
          .eq("is_primary", true)
      : Promise.resolve({ data: [], error: null }),
    loadAlbumArtworkRows(supabase, allAlbumIds),
  ]);
  if (albumsResult.error) throw albumsResult.error;
  if (editionsResult.error) throw editionsResult.error;

  const albumById = new Map(((albumsResult.data ?? []) as AlbumRow[]).map((row) => [row.retroverse_album_id, row]));
  const primaryEditionByAlbumId = new Map(
    ((editionsResult.data ?? []) as EditionRow[]).map((row) => [row.retroverse_album_id, row.retroverse_album_edition_id]),
  );

  const artistAnchorById = new Map<
    string,
    {
      albumId: string;
      coverPath: string | null;
      artworkStatus: string | null;
      albumTitle: string | null;
      releaseYear: number | null;
    }
  >();
  for (const [artistId, albumIds] of albumIdsByArtistId.entries()) {
    const candidates = [...albumIds]
      .map((albumId) => {
        const album = albumById.get(albumId);
        if (!album) return null;
        const primaryEditionId = primaryEditionByAlbumId.get(albumId) ?? null;
        const artwork = selectCanonicalArtwork(artworkRows, albumId, primaryEditionId);
        return {
          albumId,
          coverPath: artwork?.canonical_cover_path ?? null,
          artworkStatus: artwork?.artwork_status ?? null,
          albumTitle: album.canonical_album_title,
          releaseYear: album.release_year,
        };
      })
      .filter(
        (
          row,
        ): row is { albumId: string; coverPath: string | null; artworkStatus: string | null; albumTitle: string; releaseYear: number | null } =>
          row !== null,
      )
      .sort((a, b) => {
        if (a.coverPath && !b.coverPath) return -1;
        if (!a.coverPath && b.coverPath) return 1;
        const aYear = a.releaseYear ?? 9999;
        const bYear = b.releaseYear ?? 9999;
        if (aYear !== bYear) return aYear - bYear;
        return a.albumTitle.localeCompare(b.albumTitle);
      });
    if (candidates.length > 0) {
      artistAnchorById.set(artistId, candidates[0]);
    }
  }

  const artists = ((artistsResult.data ?? []) as ArtistRow[]).filter((row) =>
    query.length > 0 ? row.canonical_artist_name.toLowerCase().includes(query) : true,
  );

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-[46rem] px-4 py-10 pb-14 sm:px-6 sm:py-14">
        <header className="mb-8 space-y-3">
          <p className="text-base font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">Retroverse archive</p>
          <h1 className="font-serif text-[2.2rem] leading-[1.07] tracking-tight text-[var(--text-primary)] sm:text-[2.8rem]">
            Artists
          </h1>
          <form action="/artists" method="get" className="pt-1">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search artists"
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] px-3 py-2 text-[0.96rem] text-[var(--text-primary)] outline-none focus:border-[var(--text-secondary)]"
            />
          </form>
        </header>

        <ul className="border-y border-[var(--card-border)]/50">
          {artists.length > 0 ? (
            artists.map((artist) => {
            const href = artistRoute(artist.canonical_artist_name);
            const trackCount = trackCountByArtistId.get(artist.retroverse_artist_id) ?? 0;
            const albumCount = albumIdsByArtistId.get(artist.retroverse_artist_id)?.size ?? 0;
            const appearanceCount = appearanceCountByArtistId.get(artist.retroverse_artist_id) ?? 0;
            const anchor = artistAnchorById.get(artist.retroverse_artist_id);
            return (
              <li key={artist.retroverse_artist_id} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                <div className="flex items-start gap-2.5">
                  <CompactArtworkThumb
                    title={anchor?.albumTitle ?? `${artist.canonical_artist_name} release`}
                    canonicalCoverPath={anchor?.coverPath ?? null}
                    albumId={anchor?.albumId}
                    artist={artist.canonical_artist_name}
                    year={anchor?.releaseYear ?? null}
                    artworkStatus={anchor?.artworkStatus ?? null}
                  />
                  <div className="min-w-0">
                    <Link href={href} className="text-[0.98rem] text-[var(--text-primary)] underline-offset-2 hover:underline">
                      {artist.canonical_artist_name}
                    </Link>
                    <p className="text-[0.8rem] text-[var(--text-secondary)]/84">
                      {trackCount} tracks · {albumCount} albums · {appearanceCount} appearances
                    </p>
                    {anchor ? (
                      <p className="truncate text-[0.78rem] text-[var(--text-secondary)]/78">
                        {anchor.albumTitle}
                        {anchor.releaseYear !== null ? ` · ${anchor.releaseYear}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            );
            })
          ) : (
            <li className="border-b border-[var(--card-border)]/42 py-3 text-[0.94rem] text-[var(--text-secondary)]">
              No artists match this query.
            </li>
          )}
        </ul>
      </article>
    </div>
  );
}
