import type { Metadata } from "next";
import Link from "next/link";

import { ArtworkFrame } from "@/app/components/artwork-frame";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { hrefForArtist, hrefForAlbum } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "Albums - Retroverse",
  description: "Canonical album archive index.",
};
export const dynamic = "force-dynamic";

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  era_id: string | null;
  album_type: string | null;
  release_year: number | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
  display_name: string;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type AlbumsPageProps = {
  searchParams: Promise<{ q?: string }>;
};

export default async function AlbumsIndexPage({ searchParams }: AlbumsPageProps) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  const supabase = createClient();

  const albumsResult = await supabase
    .from("retroverse_albums")
    .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, era_id, album_type, release_year")
    .order("canonical_album_title", { ascending: true })
    .range(0, 5000);
  if (albumsResult.error) throw albumsResult.error;

  const allAlbums = (albumsResult.data ?? []) as AlbumRow[];
  const artistIds = [...new Set(allAlbums.map((row) => row.retroverse_artist_id))];
  const eraIds = [...new Set(allAlbums.map((row) => row.era_id).filter((row): row is string => Boolean(row)))];
  const albumIds = allAlbums.map((row) => row.retroverse_album_id);

  const [artistResult, eraResult, editionsResult, artworkRows] = await Promise.all([
    artistIds.length > 0
      ? supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name").in("retroverse_artist_id", artistIds)
      : Promise.resolve({ data: [], error: null }),
    eraIds.length > 0
      ? supabase.from("retroverse_eras").select("retroverse_era_id, slug, display_name").in("retroverse_era_id", eraIds)
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
  if (artistResult.error) throw artistResult.error;
  if (eraResult.error) throw eraResult.error;
  if (editionsResult.error) throw editionsResult.error;

  const artistById = new Map(((artistResult.data ?? []) as ArtistRow[]).map((row) => [row.retroverse_artist_id, row]));
  const eraById = new Map(((eraResult.data ?? []) as EraRow[]).map((row) => [row.retroverse_era_id, row]));
  const editionByAlbumId = new Map(((editionsResult.data ?? []) as EditionRow[]).map((row) => [row.retroverse_album_id, row]));

  const albums = allAlbums.filter((row) => {
    if (query.length === 0) return true;
    const artist = artistById.get(row.retroverse_artist_id);
    return (
      row.canonical_album_title.toLowerCase().includes(query) ||
      (artist?.canonical_artist_name ?? "").toLowerCase().includes(query)
    );
  });

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-[72rem] px-4 py-8 pb-12 sm:px-6 sm:py-10">
        <header className="mb-6 space-y-2 sm:mb-7">
          <p className="text-[0.82rem] tracking-[0.06em] text-[var(--text-secondary)]/82">Retroverse archive</p>
          <h1 className="font-serif text-[2rem] leading-[1.04] tracking-tight text-[var(--text-primary)] sm:text-[2.55rem]">
            Albums
          </h1>
          <form action="/albums" method="get" className="pt-0.5">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search title or artist"
              className="w-full rounded-lg border border-[var(--card-border)] bg-[var(--surface-raised)] px-3 py-2 text-[0.94rem] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]/70 focus:border-[var(--text-secondary)]"
            />
          </form>
        </header>

        <ul className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 sm:gap-x-4 sm:gap-y-5 lg:grid-cols-4">
          {albums.map((album) => {
            const artist = artistById.get(album.retroverse_artist_id);
            const era = album.era_id ? eraById.get(album.era_id) : null;
            const primaryEdition = editionByAlbumId.get(album.retroverse_album_id);
            const selectedArtwork = selectCanonicalArtwork(
              artworkRows,
              album.retroverse_album_id,
              primaryEdition?.retroverse_album_edition_id ?? null,
            );

            const traversalHref = hrefForAlbum(album.retroverse_album_id, album.canonical_album_title);
            const artistProfileHref = artist ? hrefForArtist(artist.retroverse_artist_id, artist.canonical_artist_name) : null;

            return (
              <li key={album.retroverse_album_id} className="min-w-0">
                <Link href={traversalHref} className="group block space-y-1.5">
                  <div className="transition-transform duration-200 group-hover:scale-[1.02]">
                    <ArtworkFrame
                      title={album.canonical_album_title}
                      canonicalCoverPath={selectedArtwork?.canonical_cover_path ?? null}
                      albumId={album.retroverse_album_id}
                      artist={artist?.canonical_artist_name}
                      year={album.release_year}
                      artworkStatus={selectedArtwork?.artwork_status ?? null}
                    />
                  </div>

                  <h2 className="font-serif text-[1rem] leading-tight tracking-tight text-[var(--text-primary)] group-hover:underline sm:text-[1.03rem]">
                    {album.canonical_album_title}
                  </h2>
                </Link>

                {artist ? (
                  artistProfileHref ? (
                    <p className="text-[0.84rem] leading-tight text-[var(--text-secondary)]">
                      <Link href={artistProfileHref} className="underline-offset-2 hover:underline">
                        {artist.canonical_artist_name}
                      </Link>
                    </p>
                  ) : (
                    <p className="text-[0.84rem] leading-tight text-[var(--text-secondary)]">
                      <Link
                        href={`/artists?q=${encodeURIComponent(artist.canonical_artist_name)}`}
                        className="underline-offset-2 hover:underline"
                      >
                        {artist.canonical_artist_name}
                      </Link>
                    </p>
                  )
                ) : (
                  <p className="text-[0.84rem] leading-tight text-[var(--text-secondary)]">Unknown artist</p>
                )}

                <p className="text-[0.76rem] leading-tight text-[var(--text-secondary)]/75">
                  {[album.release_year ?? "Year ?", album.album_type ?? "album", era?.display_name].filter(Boolean).join(" • ")}
                </p>
                <p className="text-[0.74rem] leading-tight text-[var(--text-secondary)]/76">
                  <Link href={traversalHref} className="underline-offset-2 hover:underline">
                    Album
                  </Link>
                  {" · "}
                  <Link href={`/tracks?q=${encodeURIComponent(album.canonical_album_title)}`} className="underline-offset-2 hover:underline">
                    Tracks
                  </Link>
                  {era ? (
                    <>
                      {" · "}
                      <Link href={`/eras/${era.slug}`} className="underline-offset-2 hover:underline">
                        Era
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ul>
      </article>
    </div>
  );
}
