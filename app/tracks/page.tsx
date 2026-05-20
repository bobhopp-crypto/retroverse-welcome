import type { Metadata } from "next";
import Link from "next/link";

import { BodyClassName } from "@/app/components/body-class-name";
import { loadCanonicalTrackIndex } from "@/lib/load-canonical-track-index";
import { artistRoute } from "@/lib/retroverse-routes";

import "@/app/albums/album-dossier.css";

export const metadata: Metadata = {
  title: "Tracks - Retroverse",
  description: "Browse chart tracks by title and artist.",
};
export const dynamic = "force-dynamic";

type TracksPageProps = {
  searchParams: Promise<{ q?: string; artist?: string; offset?: string }>;
};

const PAGE_SIZE = 90;

function parseOffset(value: string | null | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 900) : 0;
}

function withParams(searchParams: Awaited<TracksPageProps["searchParams"]>, offset: number): string {
  const params = new URLSearchParams();
  if (searchParams.q?.trim()) params.set("q", searchParams.q.trim());
  if (searchParams.artist?.trim()) params.set("artist", searchParams.artist.trim());
  params.set("offset", String(offset));
  return `/tracks?${params.toString()}`;
}

export default async function TracksIndexPage({ searchParams }: TracksPageProps) {
  const params = await searchParams;
  const offset = parseOffset(params.offset);
  const index = loadCanonicalTrackIndex({
    query: params.q,
    artist: params.artist,
    offset,
    limit: PAGE_SIZE,
  });
  const hasMore = index.rows.length < index.totalRows;

  return (
    <>
      <BodyClassName className="dossier-body" />
      <main className="dossier-shell dossier-shell--track-index">
        <header className="dossier-top dossier-top--nav">
          <Link href="/" className="dossier-a dossier-a--quiet">
            Home
          </Link>
        </header>

        <section className="dossier-readout dossier-index-readout">
          <p className="dossier-provenance-label">Chart tracks</p>
          <h1 className="dossier-title">Tracks</h1>
        </section>

        <form action="/tracks" method="get" className="dossier-panel dossier-panel--band-teal dossier-track-search">
          <label>
            <span>Search</span>
            <input name="q" defaultValue={params.q ?? ""} placeholder="Track, artist, album, or work id" />
          </label>
          <label>
            <span>Artist</span>
            <input name="artist" defaultValue={params.artist ?? ""} placeholder="Creedence Clearwater Revival" />
          </label>
          <button type="submit">Search</button>
        </form>

        <p className="dossier-provenance dossier-index-count">
          {index.totalRows.toLocaleString()} tracks
        </p>

        <section className="dossier-track-table" aria-label="Track index">
          <div className="dossier-track-head" aria-hidden>
            <span>Track</span>
            <span>Album</span>
            <span>Hot 100</span>
            <span>Links</span>
          </div>
          {index.rows.map((row) => (
            <article key={row.identityId} className="dossier-track-row">
              <div className="dossier-track-main">
                {row.hot100WorkId ? (
                  <Link href={`/tracks/hot100-${row.hot100WorkId}`} className="dossier-track-name">
                    {row.canonicalTitle}
                  </Link>
                ) : (
                  <span className="dossier-track-name">{row.canonicalTitle}</span>
                )}
                <Link href={artistRoute(row.canonicalArtist)} className="dossier-track-artist">
                  {row.canonicalArtist}
                </Link>
              </div>
              <div className="dossier-track-album">
                {row.connectedAlbumId && row.connectedAlbumTitle ? (
                  <Link href={`/albums/${row.connectedAlbumId}`}>{row.connectedAlbumTitle}</Link>
                ) : (
                  <span>—</span>
                )}
                {row.connectedAlbumYear != null ? <small>{row.connectedAlbumYear}</small> : null}
              </div>
              <div className="dossier-track-chart">
                <span>{row.hot100Peak != null ? `#${row.hot100Peak}` : "—"}</span>
                <small>{row.hot100Weeks != null ? `${row.hot100Weeks} weeks on chart` : "—"}</small>
              </div>
              <div className="dossier-track-links">
                <span>{row.linkedAlbumCount} album</span>
                <span>{row.linkedVdjCount} VDJ</span>
              </div>
            </article>
          ))}
        </section>

        {hasMore ? (
          <p className="dossier-index-more">
            <Link href={withParams(params, index.rows.length)} className="dossier-a">
              Load next {Math.min(PAGE_SIZE, index.totalRows - index.rows.length)} tracks
            </Link>
          </p>
        ) : null}
      </main>
    </>
  );
}
