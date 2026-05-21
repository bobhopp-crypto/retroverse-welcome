import type { Metadata } from "next";
import Link from "next/link";

import { BodyClassName } from "@/app/components/body-class-name";
import { EntityStatus } from "@/app/components/entity-status";
import { RetroverseEntityNav } from "@/app/components/retroverse-entity-nav";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import { loadAlbumChartRunWeeks } from "@/lib/load-album-chart-run";
import { artistRoute } from "@/lib/retroverse-routes";

import { AlbumExploreLoop } from "../../album-explore-loop";
import { AlbumDossierChartRunPanel } from "../album-dossier-chart-run";
import "../../album-dossier.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = getAlbumDossier(slug);
  if (!d) return { title: "Chart Run · Retroverse" };
  return {
    title: `Chart Run — ${d.identity.album}`,
    description: `Billboard 200 chart history for ${d.identity.album} by ${d.identity.artist}.`,
  };
}

export default async function AlbumChartRunPage({ params }: Props) {
  const { slug } = await params;
  const dossier = getAlbumDossier(slug);
  if (!dossier) {
    const id = slug.trim().toUpperCase();
    const isCanonicalId = /^RVAL\d{6}$/.test(id);
    return (
      <EntityStatus
        title={isCanonicalId ? "Album not loaded" : "Album not found"}
        message={
          isCanonicalId
            ? "This album is in the system but its chart run is not available yet."
            : "No album matches this link."
        }
        backHref="/albums"
        backLabel="Albums"
      />
    );
  }

  const { identity, chart } = dossier;
  const chartWeeks = await loadAlbumChartRunWeeks(dossier.albumId, {
    artist: identity.artist,
    album: identity.album,
  });
  const chartFirst = chart.first_chart_date ?? null;
  const chartLast = chart.last_chart_date ?? null;
  const browseYear = identity.chart_year ?? chart.retroscope_snapshot_year ?? null;

  return (
    <>
      <BodyClassName className="dossier-body" />
      <div className="dossier-shell dossier-shell--dossier dossier-shell--chart-run">
        <header className="dossier-top dossier-top--nav dossier-top--immersive dossier-top--compact">
          <RetroverseEntityNav
            immersive
            back={{ href: `/albums/${dossier.albumId}`, label: "Album" }}
            items={[
              { href: "/", label: "Search" },
              { href: "/album-retroscope", label: "Retroscope" },
              { href: browseYear != null ? `/albums?year=${browseYear}` : "/albums", label: "Albums" },
              { href: artistRoute(identity.artist), label: "Artist" },
            ]}
          />
        </header>

        <section className="dossier-readout dossier-readout--compact">
          <p className="dossier-provenance-label">Billboard 200</p>
          <h1 className="dossier-title">{identity.album}</h1>
          <p className="dossier-artist">
            <Link href={artistRoute(identity.artist)}>{identity.artist}</Link>
          </p>
        </section>

        <section className="dossier-panel dossier-panel--chart-run dossier-panel--band-plank" aria-labelledby="chart-run-heading">
          <h2 id="chart-run-heading" className="dossier-panel-label">
            Chart Run
          </h2>
          <div className="dossier-chart-run-panel dossier-chart-run-panel--page">
            <AlbumDossierChartRunPanel
              weeks={chartWeeks}
              fallbackFirst={chartFirst}
              fallbackLast={chartLast}
            />
          </div>
        </section>

        <AlbumExploreLoop artistName={identity.artist} chartYear={browseYear} />
      </div>
    </>
  );
}
