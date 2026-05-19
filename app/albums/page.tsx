import type { Metadata } from "next";
import Link from "next/link";

import { BodyClassName } from "@/app/components/body-class-name";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { getCanonicalAlbumSequencesBundleOrNull } from "@/lib/canonical-album-sequences";
import { getAlbumDossiersBundleOrNull } from "@/lib/load-album-dossier";
import type { AlbumDossier } from "@/lib/album-dossier-schema";
import { artistRoute } from "@/lib/retroverse-routes";

import "./album-dossier.css";

export const metadata: Metadata = {
  title: "Albums - Retroverse",
  description: "Canonical album archive index.",
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

function integrityFlags(album: AlbumDossier, sequenceIds: Set<string>): string[] {
  const flags: string[] = [];
  if (!album.identity.canonical_cover_path) flags.push("missing artwork");
  if (!sequenceIds.has(album.albumId)) flags.push("sequence unresolved");
  if (album.chart.peak_rank == null || album.chart.weeks_on_chart == null) flags.push("chart unresolved");
  return flags;
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

  const bundle = getAlbumDossiersBundleOrNull();
  const sequenceBundle = getCanonicalAlbumSequencesBundleOrNull();
  const sequenceIds = new Set(Object.keys(sequenceBundle?.sequences ?? {}));
  const allAlbums = Object.values(bundle?.dossiers ?? {});
  const filteredAlbums = allAlbums.filter((album) => searchMatches(album, query, artist, year)).sort(albumSort);
  const visibleAlbums = filteredAlbums.slice(0, offset + PAGE_SIZE);
  const hasMore = visibleAlbums.length < filteredAlbums.length;

  const visibleMissingArtwork = visibleAlbums.filter((album) => !album.identity.canonical_cover_path).length;
  const visibleUnresolvedSequence = visibleAlbums.filter((album) => !sequenceIds.has(album.albumId)).length;
  const visibleMissingChart = visibleAlbums.filter((album) => album.chart.peak_rank == null || album.chart.weeks_on_chart == null).length;

  return (
    <>
      <BodyClassName className="dossier-body" />
      <main className="dossier-shell dossier-shell--album-index">
        <header className="dossier-top dossier-top--nav">
          <Link href="/" className="dossier-a dossier-a--quiet">
            Home
          </Link>
        </header>

        <section className="dossier-readout dossier-index-readout">
          <p className="dossier-provenance-label">Canonical album archive</p>
          <h1 className="dossier-title">Albums</h1>
        </section>

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

        <section className="dossier-index-status" aria-label="Album archive integrity">
          <span>{filteredAlbums.length.toLocaleString()} canonical album identities</span>
          <span>{visibleUnresolvedSequence} sequence unresolved</span>
          <span>{visibleMissingArtwork} missing artwork</span>
          <span>{visibleMissingChart} chart unresolved</span>
        </section>

        <section className="dossier-index-grid" aria-label="Canonical album index">
          {visibleAlbums.map((album) => {
            const coverUrl = canonicalCoverPathToUrl(album.identity.canonical_cover_path);
            const flags = integrityFlags(album, sequenceIds);
            const yearLabel = albumYear(album) ?? "Year ?";
            return (
              <article key={album.albumId} className="dossier-index-card">
                <Link href={`/albums/${album.albumId}`} className="dossier-index-cover-link" aria-label={`${album.identity.album} by ${album.identity.artist}`}>
                  {coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- canonical archive URLs are already resolved for browser use
                    <img src={coverUrl} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <span className="dossier-index-cover-missing">No cover</span>
                  )}
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
                      <dd>{chartPeakLabel(album)}</dd>
                    </div>
                    <div>
                      <dt>Weeks</dt>
                      <dd>{album.chart.weeks_on_chart ?? "—"}</dd>
                    </div>
                  </dl>
                  {flags.length ? (
                    <p className="dossier-index-flags">{flags.join(" · ")}</p>
                  ) : (
                    <p className="dossier-index-flags dossier-index-flags--clear">identity linked</p>
                  )}
                </div>
              </article>
            );
          })}
        </section>

        {hasMore ? (
          <p className="dossier-index-more">
            <Link href={withParams(params, visibleAlbums.length)} className="dossier-a">
              Load next {Math.min(PAGE_SIZE, filteredAlbums.length - visibleAlbums.length)} albums
            </Link>
          </p>
        ) : null}
      </main>
    </>
  );
}
