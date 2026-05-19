import type { Metadata } from "next";
import Link from "next/link";

import { EntityStatus } from "@/app/components/entity-status";

import { BodyClassName } from "@/app/components/body-class-name";
import "../album-dossier.css";
import { pickCanonicalCoverForAlbum } from "@/lib/canonical-artwork-overrides";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import type { AlbumDossierTrack } from "@/lib/album-dossier-schema";
import { getCanonicalAlbumSequence, type CanonicalAlbumSequence } from "@/lib/canonical-album-sequences";
import { RetroverseEntityNav } from "@/app/components/retroverse-entity-nav";
import { artistRoute } from "@/lib/retroverse-routes";

import { AlbumDossierOperatorOverlay } from "./album-dossier-operator-overlay";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };
type CanonicalTrackDisplay = AlbumDossierTrack & {
  canonicalRefLabel?: string;
  canonicalSequenceLabel?: string;
};

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

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
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

function normalizeCanonicalTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\s*[-–—]\s*.*\bremaster(?:ed)?\b.*$/i, "")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalTrackPosition(track: CanonicalTrackDisplay, fallbackIndex: number): number | string {
  if (track.canonicalSequenceLabel) return track.canonicalSequenceLabel;
  const pos = track.musicbrainz?.position;
  return typeof pos === "number" && Number.isFinite(pos) && pos > 0 ? pos : fallbackIndex + 1;
}

function resolveCanonicalSequenceTracks(
  sequence: CanonicalAlbumSequence,
  sourceTracks: AlbumDossierTrack[],
): { tracks: CanonicalTrackDisplay[]; unresolvedTrackCount: number } {
  const sourceByTitle = new Map<string, AlbumDossierTrack>();
  const sourceByRawTitle = new Map<string, AlbumDossierTrack>();
  for (const track of sourceTracks) {
    const key = normalizeCanonicalTitle(track.title);
    if (key && !sourceByTitle.has(key)) sourceByTitle.set(key, track);
    sourceByRawTitle.set(track.title.trim(), track);
  }

  let unresolvedTrackCount = 0;
  const tracks = sequence.tracks.map((track) => {
    const source = track.source_title
      ? sourceByRawTitle.get(track.source_title.trim()) ?? sourceByTitle.get(normalizeCanonicalTitle(track.source_title))
      : sourceByTitle.get(normalizeCanonicalTitle(track.canonical_title));
    if (!source) unresolvedTrackCount += 1;

    return {
      ...source,
      title: track.canonical_title,
      duration_ms: track.duration_ms ?? source?.duration_ms ?? null,
      canonicalRefLabel: sequence.source_label,
      canonicalSequenceLabel:
        track.side_label && track.side_position != null
          ? `${track.side_label}${track.side_position}`
          : String(track.global_position),
    };
  });

  return { tracks, unresolvedTrackCount };
}

function canonicalSequenceSourceLabel(sequence: CanonicalAlbumSequence | null): string {
  return sequence?.source_label ?? "canonical_sequence_unresolved";
}

export default async function AlbumDossierPage({ params }: Props) {
  const { slug } = await params;
  const dossier = getAlbumDossier(slug);
  if (!dossier) {
    const id = slug.trim().toUpperCase();
    const isCanonicalId = /^RVAL\d{6}$/.test(id);
    return (
      <EntityStatus
        title={isCanonicalId ? "Partial data" : "Entity unavailable"}
        message={
          isCanonicalId
            ? "This album ID is recognized but the local dossier is not loaded yet."
            : "No album dossier matches this link. Try search or browse albums."
        }
        backHref="/albums"
        backLabel="Albums"
      />
    );
  }

  const { identity, chart, acoustic, related, musicbrainz } = dossier;
  const coverPick = await pickCanonicalCoverForAlbum(dossier.albumId);
  const coverUrl = canonicalCoverPathToUrl(coverPick.path, { cacheBust: coverPick.cacheBust });
  const curateHref = `/portal-v2/curate?albumId=${encodeURIComponent(dossier.albumId)}`;
  const canonicalSequence = getCanonicalAlbumSequence(dossier.albumId);
  const resolvedSequence = canonicalSequence
    ? resolveCanonicalSequenceTracks(canonicalSequence, acoustic.tracks)
    : { tracks: [], unresolvedTrackCount: acoustic.tracks.length };
  const canonicalTracks = resolvedSequence.tracks;
  const sequenceSourceLabel = canonicalSequenceSourceLabel(canonicalSequence);

  return (
    <>
      <BodyClassName className="dossier-body" />
      <div className="dossier-shell">
        <header className="dossier-top dossier-top--nav">
          <RetroverseEntityNav
            back={{ href: "/", label: "Home" }}
            items={[
              { href: artistRoute(identity.artist), label: "Artist" },
              { href: `/tracks?q=${encodeURIComponent(identity.album)}`, label: "Tracks" },
              { href: "/album-retroscope", label: "Retroscope" },
              { href: "/track-deck", label: "Charts" },
            ]}
          />
          <div className="dossier-top-end">
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
          <h2 className="dossier-panel-label">Billboard album presence</h2>
          <dl className="dossier-dl">
            <div>
              <dt>Billboard 200 peak</dt>
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

        <section className="dossier-panel dossier-panel--tracks dossier-panel--band-plank">
          <h2 className="dossier-panel-label">Canonical tracks</h2>
          <p className="dossier-provenance dossier-canonical-note">
            {canonicalSequence?.source_note ??
              "Canonical sequence unresolved. Track rows are withheld until an original listening sequence is available."}
          </p>
          <p className="dossier-provenance dossier-sequence-debug">
            Source used: {sequenceSourceLabel} · canonical sequence count: {canonicalTracks.length} · fallback source used: none · unresolved tracks: {resolvedSequence.unresolvedTrackCount}
          </p>
          {canonicalTracks.length ? (
            <div className="dossier-track-scroll">
              <table className="dossier-table dossier-table--tracks">
                <thead>
                  <tr>
                    <th className="dossier-tcol-signal">Signal</th>
                    <th className="dossier-tcol-idx">#</th>
                    <th className="dossier-tcol-title">Title</th>
                    <th>Dur</th>
                    <th>Canonical ref</th>
                  </tr>
                </thead>
                <tbody>
                  {canonicalTracks.map((tr, i) => {
                    const mb = tr.musicbrainz;
                    const mbBits = [
                      tr.canonicalRefLabel ?? null,
                      mb?.position != null ? `#${mb.position}` : null,
                      mb?.recording_mbid ? shortenId(mb.recording_mbid) : null,
                    ].filter(Boolean);
                    return (
                      <tr key={`${tr.spotify_track_id ?? tr.title}-${i}`}>
                        <td className="dossier-tcol-signal">
                          <span className="dossier-tri-signal" aria-label="Canonical sequence signal">
                            <span />
                            <span />
                            <span />
                          </span>
                        </td>
                        <td className="dossier-tcol-idx">{canonicalTrackPosition(tr, i)}</td>
                        <td className="dossier-tcol-title">
                          <span className="dossier-track-title">{tr.title}</span>
                          {mb?.disambiguation ? (
                            <span className="dossier-track-mb-hint">{String(mb.disambiguation)}</span>
                          ) : null}
                        </td>
                        <td>{formatDurationMs(tr.duration_ms ?? undefined)}</td>
                        <td className="dossier-tcol-mb">{mbBits.length ? mbBits.join(" · ") : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="dossier-unresolved-sequence" role="status">
              Canonical sequence unresolved
            </div>
          )}
        </section>

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
