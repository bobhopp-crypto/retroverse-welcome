import type { Metadata } from "next";
import Link from "next/link";

import { CompactArtworkThumb } from "@/app/components/compact-artwork-thumb";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { albumRoute } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "Tracks - Retroverse",
  description: "Canonical track archive index.",
};
export const dynamic = "force-dynamic";

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_album_id: string | null;
  release_year: number | null;
};

type AlbumRow = {
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

type TracksPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function TracksIndexPage({ searchParams }: TracksPageProps) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const supabase = createClient();

  const tracksResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title, retroverse_album_id, release_year")
    .order("canonical_title", { ascending: true })
    .range(0, 5000);
  if (tracksResult.error) throw tracksResult.error;

  const tracks = ((tracksResult.data ?? []) as TrackRow[]).filter((row) =>
    query.length > 0 ? row.canonical_title.toLowerCase().includes(query) : true,
  );
  const albumIds = [...new Set(tracks.map((row) => row.retroverse_album_id).filter((row): row is string => Boolean(row)))];
  const [albumsResult, editionsResult, artworkRows] = await Promise.all([
    albumIds.length > 0
      ? supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
          .in("retroverse_album_id", albumIds)
      : Promise.resolve({ data: [], error: null }),
    albumIds.length > 0
      ? supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id")
          .in("retroverse_album_id", albumIds)
          .eq("is_primary", true)
      : Promise.resolve({ data: [], error: null }),
    loadAlbumArtworkRows(supabase, albumIds),
  ]);
  if (albumsResult.error) throw albumsResult.error;
  if (editionsResult.error) throw editionsResult.error;
  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const artistIds = [...new Set(albums.map((row) => row.retroverse_artist_id))];
  const artistsResult =
    artistIds.length > 0
      ? await supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .in("retroverse_artist_id", artistIds)
      : { data: [], error: null };
  if (artistsResult.error) throw artistsResult.error;
  const artistById = new Map(((artistsResult.data ?? []) as ArtistRow[]).map((row) => [row.retroverse_artist_id, row.canonical_artist_name]));
  const albumById = new Map(albums.map((row) => [row.retroverse_album_id, row]));
  const primaryEditionByAlbumId = new Map(
    ((editionsResult.data ?? []) as EditionRow[]).map((row) => [row.retroverse_album_id, row.retroverse_album_edition_id]),
  );

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-[46rem] px-4 py-10 pb-14 sm:px-6 sm:py-14">
        <header className="mb-8 space-y-3">
          <p className="text-base font-medium uppercase tracking-[0.1em] text-[var(--text-secondary)]">Retroverse archive</p>
          <h1 className="font-serif text-[2.2rem] leading-[1.07] tracking-tight text-[var(--text-primary)] sm:text-[2.8rem]">
            Tracks
          </h1>
          <form action="/tracks" method="get" className="pt-1">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search tracks"
              className="w-full rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] px-3 py-2 text-[0.96rem] text-[var(--text-primary)] outline-none focus:border-[var(--text-secondary)]"
            />
          </form>
        </header>

        <ul className="border-y border-[var(--card-border)]/50">
          {tracks.map((track) => (
            <li key={track.retroverse_track_id} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
              {(() => {
                const album = track.retroverse_album_id ? albumById.get(track.retroverse_album_id) ?? null : null;
                const artwork =
                  track.retroverse_album_id && album
                    ? selectCanonicalArtwork(
                        artworkRows,
                        track.retroverse_album_id,
                        primaryEditionByAlbumId.get(track.retroverse_album_id) ?? null,
                      )
                    : null;
                return (
                  <div className="flex items-start gap-2.5">
                    <CompactArtworkThumb
                      title={album?.canonical_album_title ?? track.canonical_title}
                      canonicalCoverPath={artwork?.canonical_cover_path ?? null}
                      albumId={track.retroverse_album_id ?? undefined}
                      artist={album ? artistById.get(album.retroverse_artist_id) ?? undefined : undefined}
                      year={album?.release_year ?? track.release_year}
                      artworkStatus={artwork?.artwork_status ?? null}
                    />
                    <div className="min-w-0">
                      <Link href={`/tracks/${track.retroverse_track_id}`} className="text-[0.98rem] text-[var(--text-primary)] underline-offset-2 hover:underline">
                        {track.canonical_title}
                      </Link>
                      <p className="truncate text-[0.82rem] text-[var(--text-secondary)]/84">
                        {track.release_year !== null ? track.release_year : "Year unknown"}
                        {album ? (
                          <>
                            {" · "}
                            <Link href={albumRoute(album.canonical_album_title)} className="underline-offset-2 hover:underline">
                              {album.canonical_album_title}
                            </Link>
                          </>
                        ) : null}
                      </p>
                    </div>
                  </div>
                );
              })()}
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
