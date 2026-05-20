import Link from "next/link";

import { AlbumDossierChartRun } from "@/app/albums/[slug]/album-dossier-chart-run";
import type { AlbumChartRunWeek } from "@/lib/load-album-chart-run";
import { artistRoute } from "@/lib/retroverse-routes";

type Props = {
  albumTitle: string;
  artistName: string;
  releaseYear: number | null;
  peakRank: number | null;
  weeksOnChart: number | null;
  chartWeeks: AlbumChartRunWeek[];
  chartFirst: string | null;
  chartLast: string | null;
};

export function AlbumDossierReadout({
  albumTitle,
  artistName,
  releaseYear,
  peakRank,
  weeksOnChart,
  chartWeeks,
  chartFirst,
  chartLast,
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
      <AlbumDossierChartRun weeks={chartWeeks} fallbackFirst={chartFirst} fallbackLast={chartLast} />
    </section>
  );
}
