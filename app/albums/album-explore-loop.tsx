import Link from "next/link";

import { artistRoute } from "@/lib/retroverse-routes";

type AlbumExploreLoopProps = {
  artistName: string;
  chartYear: number | null;
};

export function AlbumExploreLoop({ artistName, chartYear }: AlbumExploreLoopProps) {
  const year = chartYear ?? null;
  return (
    <nav className="dossier-explore-loop" aria-label="Explore">
      {year != null ? (
        <Link href={`/albums?year=${year}`} className="dossier-explore-loop-link">
          ← Billboard {year}
        </Link>
      ) : null}
      <Link href={artistRoute(artistName)} className="dossier-explore-loop-link">
        {artistName}
      </Link>
      {year != null ? (
        <>
          <Link href={`/albums?year=${year - 1}`} className="dossier-explore-loop-link dossier-explore-loop-link--ghost">
            {year - 1}
          </Link>
          <Link href={`/albums?year=${year + 1}`} className="dossier-explore-loop-link dossier-explore-loop-link--ghost">
            {year + 1}
          </Link>
        </>
      ) : null}
    </nav>
  );
}
