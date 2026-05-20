import type { Metadata } from "next";
import Link from "next/link";

import { EntityStatus } from "@/app/components/entity-status";

import { BodyClassName } from "@/app/components/body-class-name";
import "../album-dossier.css";
import { pickCanonicalCoverForAlbum } from "@/lib/canonical-artwork-overrides";
import { getAlbumDetailByExternalKey, resolveAlbumCoverUrl } from "@/lib/canonical-graph";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { buildDossierTrackRows } from "@/lib/album-dossier-display-tracks";
import { loadCanonicalAlbumGraphTracks } from "@/lib/load-canonical-album-graph-tracks";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import { getDossierMusicBrainzSidecar } from "@/lib/load-dossier-musicbrainz-sidecar";
import { RetroverseEntityNav } from "@/app/components/retroverse-entity-nav";
import { homeSearchHref } from "@/lib/retroverse-nav";
import { artistRoute } from "@/lib/retroverse-routes";

import { AlbumArchiveCover } from "../album-archive-cover";
import { AlbumExploreLoop } from "../album-explore-loop";
import { AlbumDossierReadout } from "./album-dossier-readout";
import { loadLegacyVideoCache } from "@/lib/legacy-playback/video-cache";

import { AlbumDossierTracklist } from "./album-dossier-tracklist";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = getAlbumDossier(slug);
  if (!d) return { title: "Album · Retroverse" };
  return {
    title: `${d.identity.album} — ${d.identity.artist}`,
    description: (d.acoustic.editorial_summary || `${d.identity.album} · ${d.identity.artist}`)
      .replace(/\s+/g, " ")
      .slice(0, 200),
  };
}

export default async function AlbumDossierPage({ params }: Props) {
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
            ? "This album is in the system but its page is not available yet."
            : "No album matches this link. Try search or browse albums."
        }
        backHref="/albums"
        backLabel="Albums"
      />
    );
  }

  const { identity, chart, acoustic, related } = dossier;
  const [graphDetail, coverPick] = await Promise.all([
    getAlbumDetailByExternalKey(dossier.albumId),
    pickCanonicalCoverForAlbum(dossier.albumId),
  ]);
  const graphCoverUrl = graphDetail?.canonicalCoverPath
    ? canonicalCoverPathToUrl(graphDetail.canonicalCoverPath)
    : graphDetail?.r2CoverKey
      ? canonicalCoverPathToUrl(graphDetail.r2CoverKey)
      : null;
  const coverUrl =
    graphCoverUrl ??
    (await resolveAlbumCoverUrl(dossier.albumId, { pgAlbumId: graphDetail?.pgAlbumId })) ??
    canonicalCoverPathToUrl(coverPick.path, { cacheBust: coverPick.cacheBust });
  const browseYear = identity.chart_year ?? chart.retroscope_snapshot_year ?? null;
  const chartPeak = graphDetail?.peakChartPosition ?? chart.peak_rank;
  const chartWeeksCount = graphDetail?.weeksOnChart ?? chart.weeks_on_chart;
  const [graphTracks, mbSidecar, { cache: videoCache }] = await Promise.all([
    loadCanonicalAlbumGraphTracks(dossier.albumId),
    Promise.resolve(getDossierMusicBrainzSidecar(dossier.albumId)),
    loadLegacyVideoCache(),
  ]);
  const trackRows = buildDossierTrackRows(dossier.albumId, acoustic.tracks, { graphTracks, mbSidecar });

  return (
    <>
      <BodyClassName className="dossier-body" />
      <div className="dossier-shell dossier-shell--dossier">
        <header className="dossier-top dossier-top--nav dossier-top--immersive dossier-top--compact">
          <RetroverseEntityNav
            immersive
            back={{ href: browseYear != null ? `/albums?year=${browseYear}` : "/albums", label: "Albums" }}
            items={[
              { href: "/", label: "Search" },
              { href: artistRoute(identity.artist), label: "Artist" },
              { href: `/tracks?q=${encodeURIComponent(identity.album)}`, label: "Tracks" },
            ]}
          />
        </header>

        <div className="dossier-cinematic dossier-cinematic--dossier">
          <div className="dossier-hero-bezel">
            <div className="dossier-hero-inner">
              <AlbumArchiveCover src={coverUrl} title={identity.album} className="dossier-cover-frame--hero" />
            </div>
          </div>

          <AlbumDossierReadout
            albumId={dossier.albumId}
            albumTitle={identity.album}
            artistName={identity.artist}
            releaseYear={browseYear}
            peakRank={chartPeak}
            weeksOnChart={chartWeeksCount}
          />
        </div>

        <section className="dossier-panel dossier-panel--tracks dossier-panel--band-plank dossier-mobile-reveal-panel">
          <h2 className="dossier-panel-label">Tracks</h2>
          <AlbumDossierTracklist
            rows={trackRows}
            artistName={identity.artist}
            videoCache={videoCache}
          />
        </section>

        <section className="dossier-panel dossier-panel--coordinates dossier-panel--paths dossier-panel--band-violet">
          <div className="dossier-tunnels">
            <div className="dossier-tunnel">
              <h3 className="dossier-subhead dossier-subhead--tunnel">More by this artist</h3>
              <ul className="dossier-related">
                {related.same_artist_albums.map((r) => (
                  <li key={r.albumId}>
                    <Link href={`/albums/${r.albumId}`} className="dossier-a">
                      {r.album}
                    </Link>
                    <span className="dossier-related-meta">
                      {" "}
                      ({r.chartYear} · #{r.chartRank})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="dossier-tunnel">
              <h3 className="dossier-subhead dossier-subhead--tunnel">Related albums</h3>
              <ul className="dossier-related">
                {[...related.adjacent_year_same_rank, ...related.adjacent_rank_same_year].map((r, i) => (
                  <li key={`${r.albumId}-${i}`}>
                    {/^RVAL\d{6}$/i.test(r.albumId) ? (
                      <Link href={`/albums/${r.albumId}`} className="dossier-a">
                        {r.album}
                      </Link>
                    ) : (
                      <span>{r.album}</span>
                    )}
                    <span className="dossier-related-meta">
                      {" "}
                      ({r.chartYear} · #{r.chartRank})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <AlbumExploreLoop artistName={identity.artist} chartYear={browseYear} />
      </div>
    </>
  );
}
