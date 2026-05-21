import Image from "next/image";
import Link from "next/link";

import { ArchivalCoverVoid } from "@/app/components/archival-cover-void";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { tryCreateClient } from "@/lib/supabase";

export type TrackDetailHeroAlbum = {
  albumId: string;
  href: string;
  title: string;
  releaseYear?: number | null;
  coverUrl?: string | null;
};

export type TrackDetailHeroChartMeta = {
  peak: number | null;
  weeks: number | null;
  firstChartWeek: string | null;
  finalChartWeek: string | null;
};

type Props = {
  title: string;
  artistName: string;
  artistHref: string;
  releaseYear?: number | null;
  sourceLabel?: string | null;
  catalogLabel?: string | null;
  album?: TrackDetailHeroAlbum | null;
  chart?: TrackDetailHeroChartMeta | null;
};

async function loadHeroAlbumCover(albumId: string): Promise<string | null> {
  try {
    const supabase = tryCreateClient();
    if (!supabase) return null;
    const rows = await loadAlbumArtworkRows(supabase, [albumId]);
    const path = selectCanonicalArtwork(rows, albumId, null)?.canonical_cover_path ?? null;
    return canonicalCoverPathToUrl(path);
  } catch {
    return null;
  }
}

function formatPlacardDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(date)
    .replace(/,/g, "")
    .toUpperCase();
}

function formatPlacardSpan(first: string | null, final: string | null): string | null {
  const a = first ? formatPlacardDate(first) : "";
  const b = final ? formatPlacardDate(final) : "";
  if (a && b && a !== b) return `${a} → ${b}`;
  if (a) return a;
  if (b) return b;
  return null;
}

export async function TrackDetailHero({
  title,
  artistName,
  artistHref,
  releaseYear = null,
  sourceLabel,
  catalogLabel,
  album,
  chart,
}: Props) {
  const coverUrl =
    album?.coverUrl ??
    (album?.albumId?.trim() ? await loadHeroAlbumCover(album.albumId) : null);
  const albumYear = album?.releaseYear ?? releaseYear;
  const chartSpan = chart ? formatPlacardSpan(chart.firstChartWeek, chart.finalChartWeek) : null;
  const hasChartMeta =
    chart && (chart.peak != null || chart.weeks != null || chartSpan);

  return (
    <section className="dossier-readout dossier-trajectory-readout dossier-track-hero dossier-track-hero--compressed">
      <div className="dossier-track-hero-stack">
        {sourceLabel ? <p className="dossier-track-hero-source">{sourceLabel}</p> : null}
        {catalogLabel ? <p className="dossier-track-hero-catalog">{catalogLabel}</p> : null}

        <h1 className="dossier-title">{title}</h1>
        <p className="dossier-byline">
          <Link href={artistHref}>{artistName}</Link>
        </p>

        {album ? (
          <div className="dossier-track-hero-album-strip" aria-label="Source album">
            <Link
              href={album.href}
              className={`dossier-track-hero-album-strip-cover${coverUrl ? "" : " dossier-track-hero-album-strip-cover--empty"}`}
              aria-label={`Album: ${album.title}`}
            >
              {coverUrl ? (
                <Image src={coverUrl} alt="" width={52} height={52} unoptimized />
              ) : (
                <ArchivalCoverVoid compact />
              )}
            </Link>
            <div className="dossier-track-hero-album-strip-copy">
              <Link href={album.href} className="dossier-track-hero-album-strip-title">
                {album.title}
              </Link>
              {albumYear != null ? (
                <span className="dossier-track-hero-album-strip-year">{albumYear}</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {!album && releaseYear != null ? (
          <p className="dossier-track-hero-record">
            <span className="dossier-track-hero-year dossier-track-hero-year--standalone">{releaseYear}</span>
          </p>
        ) : null}

        {hasChartMeta ? (
          <p className="dossier-track-hero-meta-line" aria-label="Chart history">
            {chart!.peak != null ? (
              <>
                <span className="dossier-track-hero-meta-peak">Peak #{chart!.peak}</span>
                {chart!.weeks != null || chartSpan ? (
                  <span className="dossier-track-hero-meta-sep"> · </span>
                ) : null}
              </>
            ) : null}
            {chart!.weeks != null ? (
              <>
                <span>{chart!.weeks} weeks</span>
                {chartSpan ? <span className="dossier-track-hero-meta-sep"> · </span> : null}
              </>
            ) : null}
            {chartSpan ? <span className="dossier-track-hero-meta-span">{chartSpan}</span> : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
