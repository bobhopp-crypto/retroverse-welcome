import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BodyClassName } from "@/app/components/body-class-name";
import "../album-dossier.css";
import { pickCanonicalCoverPathForAlbum } from "@/lib/canonical-artwork-overrides";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import type { AlbumDossierTrack } from "@/lib/album-dossier-schema";
import { buildRumoursCanonicalTapestryRows } from "@/lib/rumours-proof-poc";
import { RumoursCanonicalTrackTapestry } from "./rumours-canonical-track-tapestry";
import { AlbumDossierOperatorOverlay } from "./album-dossier-operator-overlay";

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

function pctAvgTrackDuration(meanMs: number | null | undefined): number {
  if (meanMs == null || !Number.isFinite(meanMs)) return 0;
  const sec = meanMs / 1000;
  const t = (sec - 45) / (7 * 60 - 45);
  return Math.round(Math.min(1, Math.max(0, t)) * 100);
}

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function meanDurationMs(tracks: AlbumDossierTrack[]): number | null {
  const nums = tracks.map((t) => t.duration_ms).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmtMetric(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

/** Acoustic features stored as 0–1 in dossier payloads. */
function fmtRatio01Pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(Math.max(0, Math.min(1, Number(n))) * 100)}%`;
}

/** Integrated loudness (negative is typical); album meters use whole dB + house suffix. */
function fmtLoudnessDb(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${Math.round(Number(n))} DB`;
}

/** Chart anchors (YYYY-MM-DD) → readable archive copy, e.g. Feb 26, 1977. */
function formatArchiveDate(raw: string | null | undefined): string {
  if (raw == null || !String(raw).trim()) return "—";
  const s = String(raw).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const dy = Number(m[3]);
  const d = new Date(Date.UTC(y, mo - 1, dy));
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function shortenId(s: string): string {
  const t = s.trim();
  if (t.length <= 10) return t;
  return `${t.slice(0, 6)}…${t.slice(-4)}`;
}

export default async function AlbumDossierPage({ params }: Props) {
  const { slug } = await params;
  const dossier = getAlbumDossier(slug);
  if (!dossier) notFound();

  const { identity, chart, acoustic, related, scores, musicbrainz } = dossier;
  const coverUrl = canonicalCoverPathToUrl(await pickCanonicalCoverPathForAlbum(dossier.albumId));
  const means = acoustic.means;
  const curateHref = `/portal-v2/curate?albumId=${encodeURIComponent(dossier.albumId)}`;
  const avgDurMs = meanDurationMs(acoustic.tracks);
  const hasRetroverseScores =
    (scores?.album_retroverse_score != null && Number.isFinite(Number(scores.album_retroverse_score))) ||
    acoustic.tracks.some((t) => t.retroverse_score != null && Number.isFinite(Number(t.retroverse_score)));

  const rumoursCanonicalTapestry = buildRumoursCanonicalTapestryRows(dossier);

  return (
    <>
      <BodyClassName className="dossier-body" />
      <div className={`dossier-shell${rumoursCanonicalTapestry ? " dossier-shell--rumours-canonical-poc" : ""}`}>
        <header className="dossier-top">
          <Link href="/album-retroscope" className="dossier-back">
            ← RetroScope
          </Link>
          <div className="dossier-top-end">
            <span className="dossier-plate-id">{dossier.albumId}</span>
            <AlbumDossierOperatorOverlay />
          </div>
        </header>

        <div className="dossier-cinematic">
          <div className="dossier-hero-bezel">
            <div className="dossier-hero-inner">
            <Link href="/album-retroscope" className="dossier-hero-archive-link" aria-label="Open spatial archive (RetroScope)" prefetch={false}>
              {coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- R2 / public URLs from canonical path
                <img src={coverUrl} alt="" className="dossier-cover" draggable={false} decoding="async" />
              ) : (
                <div className="dossier-cover-void">No cover in archive path</div>
              )}
            </Link>
            </div>
          </div>

          <section className="dossier-readout">
            <h1 className="dossier-title">{identity.album}</h1>
            <p className="dossier-artist">{identity.artist}</p>
          </section>
        </div>

        {musicbrainz?.release_mbid ? (
          <p className="dossier-provenance dossier-provenance-strip">
            <span className="dossier-provenance-label">MusicBrainz release</span>
            <code className="dossier-mbid">{musicbrainz.release_mbid}</code>
          </p>
        ) : null}

        <section className="dossier-panel dossier-panel--chart dossier-panel--band-teal">
          <h2 className="dossier-panel-label">Archive presence</h2>
          <dl className="dossier-dl">
            <div>
              <dt>Peak archive rank</dt>
              <dd>{chart.peak_rank != null ? `#${chart.peak_rank}` : "—"}</dd>
            </div>
            <div>
              <dt>Weeks charted</dt>
              <dd>{chart.weeks_on_chart ?? "—"}</dd>
            </div>
            <div>
              <dt>First charted</dt>
              <dd>{formatArchiveDate(chart.first_chart_date)}</dd>
            </div>
            <div>
              <dt>Last charted</dt>
              <dd>{formatArchiveDate(chart.last_chart_date)}</dd>
            </div>
          </dl>
        </section>

        {hasRetroverseScores ? (
          <section className="dossier-panel dossier-panel--scores dossier-panel--band-amber">
            <h2 className="dossier-panel-label">Retroverse signal</h2>
            <dl className="dossier-dl">
              <div>
                <dt>Album score</dt>
                <dd>{scores?.album_retroverse_score != null ? fmtMetric(scores.album_retroverse_score, 2) : "—"}</dd>
              </div>
              <div>
                <dt>Track scores in sheet</dt>
                <dd>
                  {
                    acoustic.tracks.filter((t) => t.retroverse_score != null && Number.isFinite(Number(t.retroverse_score)))
                      .length
                  }
                  /{acoustic.tracks.length || "—"}
                </dd>
              </div>
            </dl>
            <p className="dossier-provenance dossier-scores-prov">
              Sourced locally from runtime/dossier-retroverse-scores-by-rval.json when present; no Supabase on this page.
            </p>
          </section>
        ) : null}

        <section className="dossier-panel dossier-panel--signal dossier-panel--band-rose">
          <h2 className="dossier-panel-label">Album mood</h2>
          <div className="dossier-signal-body dossier-signal-body--meters-only">
            <div className="dossier-signal-console" aria-label="Album mood meters">
              <div className="dossier-meters">
                {(
                  [
                    ["Energy", means.energy, "01"],
                    ["Valence", means.valence, "01"],
                    ["Danceability", means.danceability, "01"],
                    ["Acousticness", means.acousticness, "01"],
                    ["Instrumentalness", means.instrumentalness, "01"],
                    ["Speechiness", means.speechiness, "01"],
                    ["Liveness", means.liveness, "01"],
                    ["Avg track length", avgDurMs, "avgDur"],
                    ["Tempo map", means.tempo, "tempo"],
                    ["Signal density", means.loudness, "loudness"],
                  ] as const
                ).map(([label, val, kind]) => {
                  let widthPct = pct01(val);
                  if (kind === "tempo") widthPct = pctTempo(val);
                  else if (kind === "loudness") widthPct = pctLoudness(val);
                  else if (kind === "avgDur") widthPct = pctAvgTrackDuration(val);

                  let valText = "—";
                  if (val != null && Number.isFinite(Number(val))) {
                    if (kind === "tempo") valText = `${Math.round(Number(val))} BPM`;
                    else if (kind === "loudness") valText = fmtLoudnessDb(Number(val));
                    else if (kind === "avgDur") valText = formatDurationMs(Number(val));
                    else if (kind === "01") valText = `${Math.round(Math.max(0, Math.min(1, Number(val))) * 100)}%`;
                    else valText = String(val);
                  }

                  return (
                    <div key={label} className="dossier-meter">
                      <span className="dossier-meter-label">{label}</span>
                      <div className="dossier-meter-track">
                        <div className="dossier-meter-fill" style={{ width: `${widthPct}%` }} />
                      </div>
                      <span className="dossier-meter-val">{valText}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {rumoursCanonicalTapestry?.length ? (
          <RumoursCanonicalTrackTapestry rows={rumoursCanonicalTapestry} />
        ) : acoustic.tracks.length ? (
          <section className="dossier-panel dossier-panel--tracks dossier-panel--band-plank">
            <h2 className="dossier-panel-label">Tracks</h2>
            <div className="dossier-track-scroll">
              <table className="dossier-table dossier-table--features">
                <thead>
                  <tr>
                    <th className="dossier-tcol-idx">#</th>
                    <th className="dossier-tcol-title">Title</th>
                    <th>Dur</th>
                    <th>BPM</th>
                    <th>Key</th>
                    <th>Nrg</th>
                    <th>Val</th>
                    <th>Dnc</th>
                    <th>Ac</th>
                    <th>Ins</th>
                    <th>Liv</th>
                    <th>Sp</th>
                    <th>dB</th>
                    <th>RV</th>
                    <th>Brainz</th>
                  </tr>
                </thead>
                <tbody>
                  {acoustic.tracks.map((tr, i) => {
                    const mb = tr.musicbrainz;
                    const mbBits = [
                      mb?.position != null ? `#${mb.position}` : null,
                      mb?.recording_mbid ? shortenId(mb.recording_mbid) : null,
                    ].filter(Boolean);
                    return (
                      <tr key={`${tr.spotify_track_id ?? tr.title}-${i}`}>
                        <td className="dossier-tcol-idx">{i + 1}</td>
                        <td className="dossier-tcol-title">
                          <span className="dossier-track-title">{tr.title}</span>
                          {mb?.disambiguation ? (
                            <span className="dossier-track-mb-hint">{String(mb.disambiguation)}</span>
                          ) : null}
                        </td>
                        <td>{formatDurationMs(tr.duration_ms ?? undefined)}</td>
                        <td>{tr.tempo != null ? Math.round(tr.tempo) : "—"}</td>
                        <td>{tr.key_label ?? "—"}</td>
                        <td>{fmtRatio01Pct(tr.energy)}</td>
                        <td>{fmtRatio01Pct(tr.valence)}</td>
                        <td>{fmtRatio01Pct(tr.danceability)}</td>
                        <td>{fmtRatio01Pct(tr.acousticness)}</td>
                        <td>{fmtRatio01Pct(tr.instrumentalness)}</td>
                        <td>{fmtRatio01Pct(tr.liveness)}</td>
                        <td>{fmtRatio01Pct(tr.speechiness)}</td>
                        <td>{fmtLoudnessDb(tr.loudness)}</td>
                        <td>
                          {tr.retroverse_score != null && Number.isFinite(tr.retroverse_score)
                            ? tr.retroverse_score.toFixed(2)
                            : "—"}
                        </td>
                        <td className="dossier-tcol-mb">{mbBits.length ? mbBits.join(" · ") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="dossier-panel dossier-panel--coordinates dossier-panel--paths dossier-panel--band-violet">
          <div className="dossier-tunnels">
            <div className="dossier-tunnel">
              <h3 className="dossier-subhead dossier-subhead--tunnel">
                Discography<span className="dossier-tunnel-glyph" aria-hidden />
              </h3>
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
              <h3 className="dossier-subhead dossier-subhead--tunnel">
                Adjacent on Retroverse grid
                <span className="dossier-tunnel-glyph dossier-tunnel-glyph--grid" aria-hidden />
              </h3>
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

        <footer className="dossier-foot">
          <Link href={curateHref} className="dossier-a dossier-a--quiet">
            Operator · artwork
          </Link>
        </footer>
      </div>
    </>
  );
}
