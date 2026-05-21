import Image from "next/image";
import Link from "next/link";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { tryCreateClient } from "@/lib/supabase";

export type TrackDetailHeroStat = {
  label: string;
  value: string;
  /** Peak position — slightly larger numeral */
  peak?: boolean;
};

export type TrackDetailHeroAlbum = {
  albumId: string;
  href: string;
  title: string;
};

type Props = {
  title: string;
  artistName: string;
  artistHref: string;
  sourceLabel?: string | null;
  album?: TrackDetailHeroAlbum | null;
  stats: TrackDetailHeroStat[];
};

async function loadHeroAlbumCover(albumId: string): Promise<string | null> {
  const supabase = tryCreateClient();
  if (!supabase) return null;
  const rows = await loadAlbumArtworkRows(supabase, [albumId]);
  const path = selectCanonicalArtwork(rows, albumId, null)?.canonical_cover_path ?? null;
  return canonicalCoverPathToUrl(path);
}

export async function TrackDetailHero({
  title,
  artistName,
  artistHref,
  sourceLabel,
  album,
  stats,
}: Props) {
  const coverUrl = album?.albumId?.trim() ? await loadHeroAlbumCover(album.albumId) : null;

  return (
    <section className="dossier-readout dossier-trajectory-readout dossier-track-hero">
      <div className="dossier-track-hero-layout">
        {coverUrl && album ? (
          <Link href={album.href} className="dossier-track-hero-cover" aria-label={`Album: ${album.title}`}>
            <Image src={coverUrl} alt="" width={112} height={112} unoptimized />
          </Link>
        ) : null}

        <div className="dossier-track-hero-main">
          {sourceLabel ? <p className="dossier-track-hero-source">{sourceLabel}</p> : null}
          <h1 className="dossier-title">{title}</h1>
          <p className="dossier-byline">
            <Link href={artistHref}>{artistName}</Link>
          </p>
          {album ? (
            <p className="dossier-track-hero-album">
              <Link href={album.href}>{album.title}</Link>
            </p>
          ) : null}

          {stats.length > 0 ? (
            <dl className={`dossier-info-band dossier-track-hero-band dossier-track-hero-band--${stats.length}`}>
              {stats.map((stat) => (
                <div key={stat.label}>
                  <dt>{stat.label}</dt>
                  <dd className={stat.peak ? "dossier-info-band-num" : undefined}>{stat.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </div>
    </section>
  );
}
