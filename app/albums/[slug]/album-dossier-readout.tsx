import Link from "next/link";

import { artistRoute } from "@/lib/retroverse-routes";

type Props = {
  albumId: string;
  albumTitle: string;
  artistName: string;
  releaseYear: number | null;
  peakRank: number | null;
  weeksOnChart: number | null;
};

export function AlbumDossierReadout({
  albumId,
  albumTitle,
  artistName,
  releaseYear,
  peakRank,
  weeksOnChart,
}: Props) {
  return (
    <section className="dossier-readout dossier-readout--compact">
      <h1 className="dossier-title">{albumTitle}</h1>
      <p className="dossier-artist">
        <Link href={artistRoute(artistName)}>{artistName}</Link>
      </p>
      <dl className="dossier-info-band">
        <div>
          <dt>Release</dt>
          <dd>{releaseYear ?? "—"}</dd>
        </div>
        <div>
          <dt>Peak</dt>
          <dd className="dossier-info-band-num">{peakRank != null ? `#${peakRank}` : "—"}</dd>
        </div>
        <div>
          <dt>Weeks</dt>
          <dd className="dossier-info-band-num">{weeksOnChart ?? "—"}</dd>
        </div>
      </dl>
      <Link href={`/albums/${albumId}/chart-run`} className="dossier-chart-run-toggle">
        Chart Run
      </Link>
    </section>
  );
}
