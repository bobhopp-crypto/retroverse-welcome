"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { AlbumCuratorRepair, type CuratorAlbumContext } from "@/app/components/album-curator-repair";

export type SearchAlbumRowProps = {
  albumId: string;
  title: string;
  artist: string;
  year: number | null;
  coverUrl: string | null;
  canonicalCoverPath: string | null;
  trustState: CuratorAlbumContext["trustState"];
};

export function SearchAlbumRow({ albumId, title, artist, year, coverUrl, canonicalCoverPath, trustState }: SearchAlbumRowProps) {
  const [imgBroken, setImgBroken] = useState(false);
  const href = `/albums/${albumId}`;
  const context: CuratorAlbumContext = {
    albumId,
    albumSlug: albumId,
    albumTitle: title,
    artist,
    year,
    trustState,
    canonicalCoverPath,
    trackCount: null,
  };
  const showImg = Boolean(coverUrl && !imgBroken);

  return (
    <Link
      href={href}
      className="block rounded-2xl border border-[var(--card-border)]/50 bg-[var(--surface-raised)]/55 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.75)] transition hover:border-[var(--card-border)]/85 hover:bg-[var(--surface-raised)]/75 active:scale-[0.99]"
      aria-label={`Open album: ${title}`}
    >
      <AlbumCuratorRepair context={context} captureLinkNavigationClicks className="">
        <div className="flex gap-4 p-3.5 sm:p-4">
          <div className="relative h-[4.5rem] w-[4.5rem] shrink-0 overflow-hidden rounded-xl border border-[var(--card-border)]/60 bg-[var(--surface)]">
            {showImg ? (
              <Image
                src={coverUrl!}
                alt={`${title} cover`}
                width={144}
                height={144}
                unoptimized
                className="h-full w-full object-cover"
                onError={() => setImgBroken(true)}
              />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_25%_25%,rgba(236,198,148,0.18),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(136,164,206,0.16),transparent_48%),linear-gradient(130deg,rgba(54,48,42,0.92),rgba(28,32,40,0.96))]"
                aria-hidden
              />
            )}
          </div>
          <div className="min-w-0 flex-1 py-0.5">
            <p className="font-serif text-lg leading-snug tracking-tight text-[var(--text-primary)] sm:text-[1.28rem]">{title}</p>
            <p className="mt-1 text-[0.95rem] leading-snug text-[var(--text-secondary)]">{artist}</p>
            <p className="mt-1 text-[0.9rem] tabular-nums text-[var(--text-secondary)]/88">{year !== null ? String(year) : "Year unknown"}</p>
            <p className="mt-2 font-mono text-[0.68rem] leading-none tracking-wide text-[var(--text-secondary)]/55">{albumId}</p>
          </div>
        </div>
      </AlbumCuratorRepair>
    </Link>
  );
}
