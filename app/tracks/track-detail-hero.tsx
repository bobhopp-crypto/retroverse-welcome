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

type Props = {
  title: string;
  artistName: string;
  artistHref: string;
  releaseYear?: number | null;
  album?: TrackDetailHeroAlbum | null;
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

export async function TrackDetailHero({
  title,
  artistName,
  artistHref,
  releaseYear = null,
  album,
}: Props) {
  const coverUrl =
    album?.coverUrl ??
    (album?.albumId?.trim() ? await loadHeroAlbumCover(album.albumId) : null);
  const displayYear = album?.releaseYear ?? releaseYear;
  const showAlbumRef =
    album != null &&
    album.title.trim().toLowerCase() !== title.trim().toLowerCase();

  const artInner = coverUrl ? (
    <Image src={coverUrl} alt="" width={280} height={280} unoptimized priority />
  ) : (
    <ArchivalCoverVoid />
  );

  const artFrame = album ? (
    <Link
      href={album.href}
      className={`dossier-track-hero-poster-art${coverUrl ? "" : " dossier-track-hero-poster-art--empty"}`}
      aria-label={`Album: ${album.title}`}
    >
      {artInner}
    </Link>
  ) : (
    <div
      className={`dossier-track-hero-poster-art dossier-track-hero-poster-art--empty${coverUrl ? "" : " dossier-track-hero-poster-art--void"}`}
      aria-hidden={!coverUrl}
    >
      {artInner}
    </div>
  );

  return (
    <section className="dossier-readout dossier-trajectory-readout dossier-track-hero dossier-track-hero--poster">
      <div className="dossier-track-hero-poster">
        <div className="dossier-track-hero-poster-bezel">{artFrame}</div>
        <div className="dossier-track-hero-poster-credits">
          <h1 className="dossier-title">{title}</h1>
          <div className="dossier-track-hero-poster-line2">
            <div className="dossier-track-hero-poster-meta-left">
              <Link className="dossier-track-hero-poster-artist" href={artistHref}>
                {artistName}
              </Link>
              {showAlbumRef ? (
                <>
                  <span className="dossier-track-hero-poster-sep" aria-hidden>
                    {" "}
                    ·{" "}
                  </span>
                  <Link href={album.href} className="dossier-track-hero-poster-album">
                    {album.title}
                  </Link>
                </>
              ) : null}
            </div>
            {displayYear != null ? (
              <span className="dossier-track-hero-poster-year">{displayYear}</span>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
