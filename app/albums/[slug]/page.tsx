import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BodyClassName } from "@/app/components/body-class-name";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { getAlbumDossier } from "@/lib/load-album-dossier";

import "../album-dossier.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = getAlbumDossier(slug);
  if (!d) return { title: "Album · Retroverse" };
  return {
    title: `${d.identity.album} — ${d.identity.artist}`,
    description: d.acoustic.editorial_summary.slice(0, 200),
  };
}

function pct01(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 100);
}

function pctTempo(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  const t = (Number(n) - 60) / (200 - 60);
  return Math.round(Math.min(1, Math.max(0, t)) * 100);
}

function pctLoudness(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return 0;
  const t = (Number(n) + 60) / 60;
  return Math.round(Math.min(1, Math.max(0, t)) * 100);
}

export default async function AlbumDossierPage({ params }: Props) {
  const { slug } = await params;
  const dossier = getAlbumDossier(slug);
  if (!dossier) notFound();

  const { identity, chart, acoustic, related } = dossier;
  const coverUrl = canonicalCoverPathToUrl(identity.canonical_cover_path);
  const means = acoustic.means;
  const curateHref = `/portal-v2/curate?albumId=${encodeURIComponent(dossier.albumId)}`;

  return (
    <>
      <BodyClassName className="dossier-body" />
      <div className="dossier-shell">
        <header className="dossier-top">
          <Link href="/album-retroscope" className="dossier-back">
            ← RetroScope
          </Link>
          <span className="dossier-plate-id">{dossier.albumId}</span>
        </header>

        <div className="dossier-hero-bezel">
          <div className="dossier-hero-inner">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- R2 / public URLs from canonical path
              <img src={coverUrl} alt="" className="dossier-cover" draggable={false} decoding="async" />
            ) : (
              <div className="dossier-cover-void">No cover in archive path</div>
            )}
          </div>
        </div>

        <section className="dossier-readout">
          <h1 className="dossier-title">{identity.album}</h1>
          <p className="dossier-artist">{identity.artist}</p>
          <p className="dossier-eyebrow">
            {identity.chart_year} · rank {identity.chart_rank} snapshot · grid {identity.retroscope_key}
          </p>
          <p className="dossier-trust">
            {identity.identity_state ?? "—"} · trust {identity.trust_score ?? "—"}
          </p>
        </section>

        <section className="dossier-panel">
          <h2 className="dossier-panel-label">Chart — archive run</h2>
          <dl className="dossier-dl">
            <div>
              <dt>Peak rank</dt>
              <dd>{chart.peak_rank != null ? `#${chart.peak_rank}` : "—"}</dd>
            </div>
            <div>
              <dt>Weeks on BB200</dt>
              <dd>{chart.weeks_on_chart ?? "—"}</dd>
            </div>
            <div>
              <dt>First → last chart</dt>
              <dd>
                {(chart.first_chart_date ?? "—")} → {chart.last_chart_date ?? "—"}
              </dd>
            </div>
          </dl>
          {chart.nearby_snapshot_positions?.length ? (
            <ul className="dossier-related-mini">
              {chart.nearby_snapshot_positions.map((p, i) => {
                const py = p.chartYear as number | undefined;
                const pr = p.chartRank as number | undefined;
                const pid = typeof p.albumId === "string" ? p.albumId : "";
                const palbum = typeof p.album === "string" ? p.album : "";
                return (
                  <li key={`${py}-${pr}-${i}`}>
                    {py} #{pr} — {palbum}{" "}
                    {/^RVAL\d{6}$/i.test(pid) ? (
                      <Link href={`/albums/${pid}`} className="dossier-a">
                        open
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section className="dossier-panel dossier-panel--signal">
          <h2 className="dossier-panel-label">Acoustic — interpretive profile</h2>
          <p className="dossier-editorial">{acoustic.editorial_summary}</p>
          {acoustic.descriptors.length ? (
            <ul className="dossier-descriptors">
              {acoustic.descriptors.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
          <p className="dossier-track-count">
            {acoustic.track_count} feature rows matched on artist + album (Billboard cohort)
          </p>
          <div className="dossier-meters">
            {(
              [
                ["Energy", means.energy, "01"],
                ["Valence", means.valence, "01"],
                ["Danceability", means.danceability, "01"],
                ["Acousticness", means.acousticness, "01"],
                ["Instrumentalness", means.instrumentalness, "01"],
                ["Tempo map", means.tempo, "tempo"],
                ["Loudness map", means.loudness, "loudness"],
              ] as const
            ).map(([label, val, kind]) => (
              <div key={label} className="dossier-meter">
                <span className="dossier-meter-label">{label}</span>
                <div className="dossier-meter-track">
                  <div
                    className="dossier-meter-fill"
                    style={{
                      width: `${
                        kind === "tempo" ? pctTempo(val) : kind === "loudness" ? pctLoudness(val) : pct01(val)
                      }%`,
                    }}
                  />
                </div>
                <span className="dossier-meter-val">
                  {val != null ? (kind === "tempo" ? `${Math.round(Number(val))} BPM` : String(val)) : "—"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {acoustic.tracks.length ? (
          <section className="dossier-panel">
            <h2 className="dossier-panel-label">Tracks — feature sheet</h2>
            <div className="dossier-track-scroll">
              <table className="dossier-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Nrg</th>
                    <th>Val</th>
                    <th>Dnc</th>
                  </tr>
                </thead>
                <tbody>
                  {acoustic.tracks.slice(0, 36).map((tr, i) => (
                    <tr key={`${tr.title}-${i}`}>
                      <td>{tr.title}</td>
                      <td>{tr.energy != null ? tr.energy.toFixed(2) : "—"}</td>
                      <td>{tr.valence != null ? tr.valence.toFixed(2) : "—"}</td>
                      <td>{tr.danceability != null ? tr.danceability.toFixed(2) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="dossier-panel">
          <h2 className="dossier-panel-label">Related coordinates</h2>
          <h3 className="dossier-subhead">Same artist</h3>
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
          <h3 className="dossier-subhead">Adjacent on RetroScope grid</h3>
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
        </section>

        <footer className="dossier-foot">
          <Link href={curateHref} className="dossier-a dossier-a--quiet">
            Operator · artwork
          </Link>
        </footer>
      </div>
    </>
  );
}
