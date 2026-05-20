import type { Metadata } from "next";
import Link from "next/link";

import { BodyClassName } from "@/app/components/body-class-name";
import { attachCoverUrlsToYearAlbums, getYearAlbums, isCanonicalGraphEnabled } from "@/lib/canonical-graph";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { getAlbumDossiersBundleOrNull } from "@/lib/load-album-dossier";
import type { AlbumDossier } from "@/lib/album-dossier-schema";
import { artistRoute } from "@/lib/retroverse-routes";

import { AlbumArchiveCover } from "./album-archive-cover";
import { YearTimelineNav } from "./year-timeline-nav";
import "./album-dossier.css";

export const metadata: Metadata = {
  title: "Albums - Retroverse",
  description: "Browse albums by year and chart peak — Billboard 200 archive.",
};
export const dynamic = "force-dynamic";

type AlbumsPageProps = {
  searchParams: Promise<{ q?: string; year?: string; artist?: string; offset?: string }>;
};

const PAGE_SIZE = 60;

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function parseYear(value: string | null | undefined): number | null {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 1900 && n < 2100 ? n : null;
}

function parseOffset(value: string | null | undefined): number {
  const n = Number.parseInt((value ?? "").trim(), 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 600) : 0;
}

function chartPeakLabel(album: AlbumDossier): string {
  return album.chart.peak_rank != null ? `#${album.chart.peak_rank}` : "—";
}

function albumYear(album: AlbumDossier): number | null {
  return album.identity.chart_year ?? album.chart.retroscope_snapshot_year ?? null;
}

function searchMatches(album: AlbumDossier, query: string, artist: string, year: number | null): boolean {
  if (query) {
    const haystack = `${album.identity.album} ${album.identity.artist} ${album.albumId}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (artist && !album.identity.artist.toLowerCase().includes(artist)) return false;
  if (year != null && albumYear(album) !== year) return false;
  return true;
}

function albumSort(a: AlbumDossier, b: AlbumDossier): number {
  const peakA = a.chart.peak_rank ?? 999;
  const peakB = b.chart.peak_rank ?? 999;
  if (peakA !== peakB) return peakA - peakB;
  const weeksA = a.chart.weeks_on_chart ?? -1;
  const weeksB = b.chart.weeks_on_chart ?? -1;
  if (weeksA !== weeksB) return weeksB - weeksA;
  return a.identity.album.localeCompare(b.identity.album);
}

function withParams(searchParams: Awaited<AlbumsPageProps["searchParams"]>, offset: number): string {
  const params = new URLSearchParams();
  if (searchParams.q?.trim()) params.set("q", searchParams.q.trim());
  if (searchParams.year?.trim()) params.set("year", searchParams.year.trim());
  if (searchParams.artist?.trim()) params.set("artist", searchParams.artist.trim());
  params.set("offset", String(offset));
  return `/albums?${params.toString()}`;
}

export default async function AlbumsIndexPage({ searchParams }: AlbumsPageProps) {
  const params = await searchParams;
  const query = norm(params.q);
  const artist = norm(params.artist);
  const year = parseYear(params.year);
  const offset = parseOffset(params.offset);

  const graphRowsRaw =
    year != null && !query && !artist && isCanonicalGraphEnabled() ? await getYearAlbums(year) : [];
  const useGraphYear = graphRowsRaw.length > 0;
  const graphSlice = useGraphYear ? graphRowsRaw.slice(0, offset + PAGE_SIZE) : [];
  const graphRows = useGraphYear ? await attachCoverUrlsToYearAlbums(graphSlice) : [];

  const bundle = getAlbumDossiersBundleOrNull();
  const allAlbums = Object.values(bundle?.dossiers ?? {});
  const filteredAlbums = useGraphYear
    ? []
    : allAlbums.filter((album) => searchMatches(album, query, artist, year)).sort(albumSort);
  const visibleAlbums = useGraphYear ? [] : filteredAlbums.slice(0, offset + PAGE_SIZE);
  const hasMore = useGraphYear
    ? graphSlice.length < graphRowsRaw.length
    : visibleAlbums.length < filteredAlbums.length;
  const listCount = useGraphYear ? graphRowsRaw.length : filteredAlbums.length;

  return (
    <>
      <BodyClassName className="dossier-body" />
      <main
        className={`dossier-shell dossier-shell--album-index${useGraphYear && year != null ? " dossier-shell--year-immersion" : ""}`}
      >
        <header className="dossier-top dossier-top--nav">
          <Link href="/" className="dossier-a dossier-a--quiet">
            Home
          </Link>
          <Link href="/albums" className="dossier-a dossier-a--quiet">
            Albums
          </Link>
        </header>

        <section className="dossier-readout dossier-index-readout">
          <p className="dossier-provenance-label">
            {useGraphYear && year ? `Billboard 200 · ${year}` : "Album archive"}
          </p>
          <h1 className="dossier-title">{useGraphYear && year ? String(year) : "Albums"}</h1>
        </section>

        {useGraphYear && year != null ? <YearTimelineNav year={year} albumCount={listCount} /> : null}

        <form action="/albums" method="get" className="dossier-panel dossier-panel--band-teal dossier-index-search">
          <label>
            <span>Search</span>
            <input name="q" defaultValue={params.q ?? ""} placeholder="Album, artist, or RVAL" />
          </label>
          <label>
            <span>Year</span>
            <input name="year" defaultValue={params.year ?? ""} inputMode="numeric" placeholder="1977" />
          </label>
          <label>
            <span>Artist</span>
            <input name="artist" defaultValue={params.artist ?? ""} placeholder="Fleetwood Mac" />
          </label>
          <button type="submit">Search archive</button>
        </form>

        {!useGraphYear && listCount > 0 ? (
          <p className="dossier-provenance dossier-index-count">
            {listCount.toLocaleString()} albums in the archive
          </p>
        ) : null}

        <section className="dossier-index-grid" aria-label="Album index">
          {useGraphYear
            ? graphRows.map((row) => {
                const peak = row.peakChartPosition != null ? `#${row.peakChartPosition}` : null;
                return (
                  <article key={row.albumId} className="dossier-index-card" style={{ order: row.displayRank }}>
                    <Link
                      href={`/albums/${row.albumId}`}
                      className="dossier-index-cover-link"
                      aria-label={`${row.albumTitle} by ${row.artistName}`}
                    >
                      <AlbumArchiveCover
                        src={row.coverUrl}
                        title={row.albumTitle}
                        rankLabel={peak}
                      />
                    </Link>
                    <div className="dossier-index-card-copy">
                      <p className="dossier-index-rank-line">
                        <span className="dossier-index-rank">{row.displayRank}</span>
                        {peak ? <span className="dossier-index-peak">{peak}</span> : null}
                      </p>
                      <h2>
                        <Link href={`/albums/${row.albumId}`}>{row.albumTitle}</Link>
                      </h2>
                      <p>
                        <Link href={artistRoute(row.artistName)}>{row.artistName}</Link>
                      </p>
                      <dl>
                        <div>
                          <dt>Weeks</dt>
                          <dd>{row.weeksOnChart ?? "—"}</dd>
                        </div>
                        <div>
                          <dt>First</dt>
                          <dd>{row.firstChartDate?.slice(0, 4) ?? "—"}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                );
              })
            : visibleAlbums.map((album) => {
                const coverUrl = canonicalCoverPathToUrl(album.identity.canonical_cover_path);
                const yearLabel = albumYear(album) ?? "—";
                const peak = chartPeakLabel(album);
                return (
                  <article key={album.albumId} className="dossier-index-card">
                    <Link
                      href={`/albums/${album.albumId}`}
                      className="dossier-index-cover-link"
                      aria-label={`${album.identity.album} by ${album.identity.artist}`}
                    >
                      <AlbumArchiveCover
                        src={coverUrl}
                        title={album.identity.album}
                        rankLabel={peak !== "—" ? peak : null}
                      />
                    </Link>
                    <div className="dossier-index-card-copy">
                      <h2>
                        <Link href={`/albums/${album.albumId}`}>{album.identity.album}</Link>
                      </h2>
                      <p>
                        <Link href={artistRoute(album.identity.artist)}>{album.identity.artist}</Link>
                      </p>
                      <dl>
                        <div>
                          <dt>Year</dt>
                          <dd>{yearLabel}</dd>
                        </div>
                        <div>
                          <dt>Peak</dt>
                          <dd>{peak}</dd>
                        </div>
                        <div>
                          <dt>Weeks</dt>
                          <dd>{album.chart.weeks_on_chart ?? "—"}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                );
              })}
        </section>

        {hasMore ? (
          <p className="dossier-index-more">
            <Link
              href={withParams(params, useGraphYear ? graphSlice.length : visibleAlbums.length)}
              className="dossier-a"
            >
              Continue through {year ?? "the archive"}…
            </Link>
          </p>
        ) : null}
      </main>
    </>
  );
}
