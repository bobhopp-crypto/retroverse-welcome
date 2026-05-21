import Image from "next/image";
import Link from "next/link";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { tryCreateClient } from "@/lib/supabase";

export type TrackDetailHeroAlbum = {
  albumId: string;
  href: string;
  title: string;
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
  const supabase = tryCreateClient();
  if (!supabase) return null;
  const rows = await loadAlbumArtworkRows(supabase, [albumId]);
  const path = selectCanonicalArtwork(rows, albumId, null)?.canonical_cover_path ?? null;
  return canonicalCoverPathToUrl(path);
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
  const coverUrl = album?.albumId?.trim() ? await loadHeroAlbumCover(album.albumId) : null;
  const chartSpan = chart ? formatPlacardSpan(chart.firstChartWeek, chart.finalChartWeek) : null;
  const hasChartPlacard =
    chart &&
    (chart.peak != null || chart.weeks != null || chartSpan);

  return (
    <section className="dossier-readout dossier-trajectory-readout dossier-track-hero">
      <div className={`dossier-track-hero-layout${album ? "" : " dossier-track-hero-layout--no-cover"}`}>
        {album ? (
          <div className="dossier-track-hero-plate">
            {coverUrl ? (
              <Link href={album.href} className="dossier-track-hero-cover" aria-label={`Album: ${album.title}`}>
                <Image src={coverUrl} alt="" width={112} height={112} unoptimized />
              </Link>
            ) : (
              <Link href={album.href} className="dossier-track-hero-cover dossier-track-hero-cover--empty" aria-label={`Album: ${album.title}`}>
                <span aria-hidden />
              </Link>
            )}
          </div>
        ) : null}

        <div className="dossier-track-hero-main">
          {sourceLabel ? <p className="dossier-track-hero-source">{sourceLabel}</p> : null}
          {catalogLabel ? <p className="dossier-track-hero-catalog">{catalogLabel}</p> : null}

          <h1 className="dossier-title">{title}</h1>
          <p className="dossier-byline">
            <Link href={artistHref}>{artistName}</Link>
          </p>

          {album ? (
            <p className="dossier-track-hero-record">
              <Link href={album.href} className="dossier-track-hero-album-title">
                {album.title}
              </Link>
              {releaseYear != null ? (
                <span className="dossier-track-hero-year">{releaseYear}</span>
              ) : null}
            </p>
          ) : releaseYear != null ? (
            <p className="dossier-track-hero-record">
              <span className="dossier-track-hero-year dossier-track-hero-year--standalone">{releaseYear}</span>
            </p>
          ) : null}

          {hasChartPlacard ? (
            <p className="dossier-track-hero-placard" aria-label="Chart history">
              {chart!.peak != null ? (
                <span className="dossier-track-hero-placard-item dossier-track-hero-placard-item--peak">
                  PEAK #{chart!.peak}
                </span>
              ) : null}
              {chart!.weeks != null ? (
                <span className="dossier-track-hero-placard-item">
                  {chart!.weeks} WEEKS
                </span>
              ) : null}
              {chartSpan ? (
                <span className="dossier-track-hero-placard-item dossier-track-hero-placard-item--span">
                  {chartSpan}
                </span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
