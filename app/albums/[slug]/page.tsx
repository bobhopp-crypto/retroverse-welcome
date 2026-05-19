import type { Metadata } from "next";
import Link from "next/link";

import { EntityStatus } from "@/app/components/entity-status";

import { BodyClassName } from "@/app/components/body-class-name";
import "../album-dossier.css";
import { pickCanonicalCoverForAlbum } from "@/lib/canonical-artwork-overrides";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import type { AlbumDossierTrack } from "@/lib/album-dossier-schema";
import { RetroverseEntityNav } from "@/app/components/retroverse-entity-nav";
import { artistRoute } from "@/lib/retroverse-routes";

import { AlbumDossierOperatorOverlay } from "./album-dossier-operator-overlay";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };
type CanonicalTrackDisplay = AlbumDossierTrack & {
  canonicalRefLabel?: string;
  canonicalSequenceLabel?: string;
};
type CanonicalTrackOverride = {
  sourceNote: string;
  tracks: Array<{ side: string; title: string; sourceTitle?: string }>;
};

const CANONICAL_TRACK_OVERRIDES: Record<string, CanonicalTrackOverride> = {
  RVAL110155: {
    sourceNote:
      "Canonical 2LP side sequence shown from the MusicBrainz/Discogs release identity; local acoustic source has Spotify rows that omit LP cuts and add bonus/unissued material.",
    tracks: [
      { side: "A1", title: "Watch Out" },
      { side: "A2", title: "Ooh Baby" },
      { side: "A3", title: "South Indiana - Take 1" },
      { side: "A4", title: "South Indiana - Take 2" },
      { side: "A5", title: "Last Night" },
      { side: "A6", title: "Red Hot Jam" },
      { side: "B1", title: "World's in a Tangle" },
      { side: "B2", title: "Talk with You" },
      { side: "B3", title: "Like It This Way" },
      { side: "B4", title: "Someday Soon Baby" },
      { side: "B5", title: "Hungry Country Girl" },
      { side: "C1", title: "I'm Worried" },
      { side: "C2", title: "I Held My Baby Last Night" },
      { side: "C3", title: "Madison Blues" },
      { side: "C4", title: "I Can't Hold Out" },
      { side: "C5", title: "I Need Your Love" },
      { side: "C6", title: "I Got the Blues" },
      { side: "D1", title: "Black Jack Blues" },
      { side: "D2", title: "Everyday I Have the Blues" },
      { side: "D3", title: "Rockin' Boogie" },
      { side: "D4", title: "Sugar Mama" },
      { side: "D5", title: "Homework" },
    ],
  },
  RVAL000003: {
    sourceNote:
      "Canonical Rumours LP sequence shown from the original album identity; non-LP source rows stay outside the main listening sequence.",
    tracks: [
      { side: "A1", title: "Second Hand News" },
      { side: "A2", title: "Dreams" },
      { side: "A3", title: "Never Going Back Again" },
      { side: "A4", title: "Don't Stop" },
      { side: "A5", title: "Go Your Own Way" },
      { side: "A6", title: "Songbird" },
      { side: "B1", title: "The Chain" },
      { side: "B2", title: "You Make Loving Fun" },
      { side: "B3", title: "I Don't Want to Know" },
      { side: "B4", title: "Oh Daddy" },
      { side: "B5", title: "Gold Dust Woman" },
    ],
  },
  RVAL205451: {
    sourceNote:
      "Canonical Abbey Road LP sequence shown from the original album identity; local source durations are matched without rendering source edition labels.",
    tracks: [
      { side: "A1", title: "Come Together" },
      { side: "A2", title: "Something" },
      { side: "A3", title: "Maxwell's Silver Hammer" },
      { side: "A4", title: "Oh! Darling" },
      { side: "A5", title: "Octopus's Garden" },
      { side: "A6", title: "I Want You (She's So Heavy)" },
      { side: "B1", title: "Here Comes The Sun" },
      { side: "B2", title: "Because" },
      { side: "B3", title: "You Never Give Me Your Money" },
      { side: "B4", title: "Sun King" },
      { side: "B5", title: "Mean Mr Mustard" },
      { side: "B6", title: "Polythene Pam" },
      { side: "B7", title: "She Came In Through The Bathroom Window" },
      { side: "B8", title: "Golden Slumbers" },
      { side: "B9", title: "Carry That Weight" },
      { side: "B10", title: "The End" },
      { side: "B11", title: "Her Majesty" },
    ],
  },
  RVAL695796: {
    sourceNote:
      "Canonical Dark Side LP sequence shown from the original album identity; local source rows are reordered into album listening order.",
    tracks: [
      { side: "A1", title: "Speak to Me" },
      { side: "A2", title: "Breathe (In the Air)" },
      { side: "A3", title: "On the Run" },
      { side: "A4", title: "Time" },
      { side: "A5", title: "The Great Gig in the Sky" },
      { side: "B1", title: "Money" },
      { side: "B2", title: "Us and Them" },
      { side: "B3", title: "Any Colour You Like" },
      { side: "B4", title: "Brain Damage" },
      { side: "B5", title: "Eclipse" },
    ],
  },
  RVAL281995: {
    sourceNote:
      "Canonical Hotel California LP sequence shown from the original album identity; local source durations are matched without rendering source edition labels.",
    tracks: [
      { side: "A1", title: "Hotel California" },
      { side: "A2", title: "New Kid in Town" },
      { side: "A3", title: "Life in the Fast Lane" },
      { side: "A4", title: "Wasted Time", sourceTitle: "Wasted Time - Eagles 2013 Remaster" },
      { side: "B1", title: "Wasted Time (Reprise)", sourceTitle: "Wasted Time - 2013 Remaster" },
      { side: "B2", title: "Victim of Love" },
      { side: "B3", title: "Pretty Maids All in a Row" },
      { side: "B4", title: "Try and Love Again" },
      { side: "B5", title: "The Last Resort" },
    ],
  },
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

const POLLUTED_TRACK_TITLE =
  /\b(previously\s+unissued|bonus\s+track|bonus|take\s+\d+|early\s+take|alternate|outtake|outtakes|demo|instrumental|remaster(?:ed)?|expanded|deluxe|incomplete)\b/i;

function isCanonicalListeningTrack(track: AlbumDossierTrack): boolean {
  const title = track.title?.trim() ?? "";
  if (!title) return false;
  if (POLLUTED_TRACK_TITLE.test(title)) return false;
  if (/\s[-–—]\s*live\b/i.test(title)) return false;
  return true;
}

function canonicalTrackPosition(track: CanonicalTrackDisplay, fallbackIndex: number): number | string {
  if (track.canonicalSequenceLabel) return track.canonicalSequenceLabel;
  const pos = track.musicbrainz?.position;
  return typeof pos === "number" && Number.isFinite(pos) && pos > 0 ? pos : fallbackIndex + 1;
}

function canonicalTrackSortPosition(track: AlbumDossierTrack, fallbackIndex: number): number {
  const pos = track.musicbrainz?.position;
  return typeof pos === "number" && Number.isFinite(pos) && pos > 0 ? pos : fallbackIndex + 1;
}

function resolveCanonicalTracks(tracks: AlbumDossierTrack[]): CanonicalTrackDisplay[] {
  const filtered = tracks.filter(isCanonicalListeningTrack);
  if (filtered.length === 0) return [];
  const positions = filtered
    .map((track) => track.musicbrainz?.position)
    .filter((pos): pos is number => typeof pos === "number" && Number.isFinite(pos) && pos > 0);
  const canSortByPosition = positions.length === filtered.length && new Set(positions).size === positions.length;
  return canSortByPosition
    ? filtered.slice().sort((a, b) => canonicalTrackSortPosition(a, 0) - canonicalTrackSortPosition(b, 0))
    : filtered;
}

function resolveCanonicalOverrideTracks(
  albumId: string,
  sourceTracks: AlbumDossierTrack[],
): { tracks: CanonicalTrackDisplay[]; sourceNote: string } | null {
  const override = CANONICAL_TRACK_OVERRIDES[albumId];
  if (!override) return null;

  const sourceByTitle = new Map<string, AlbumDossierTrack>();
  const sourceByRawTitle = new Map<string, AlbumDossierTrack>();
  for (const track of sourceTracks) {
    const key = normalizeCanonicalTitle(track.title);
    if (key && !sourceByTitle.has(key)) sourceByTitle.set(key, track);
    sourceByRawTitle.set(track.title.trim(), track);
  }

  return {
    sourceNote: override.sourceNote,
    tracks: override.tracks.map((track) => {
      const source = track.sourceTitle
        ? sourceByRawTitle.get(track.sourceTitle.trim()) ?? sourceByTitle.get(normalizeCanonicalTitle(track.sourceTitle))
        : sourceByTitle.get(normalizeCanonicalTitle(track.title));
      return {
        ...source,
        title: track.title,
        duration_ms: source?.duration_ms ?? null,
        canonicalRefLabel: "original side sequence",
        canonicalSequenceLabel: track.side,
      };
    }),
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
  const canonicalOverride = resolveCanonicalOverrideTracks(dossier.albumId, acoustic.tracks);
  const canonicalTracks = canonicalOverride?.tracks ?? resolveCanonicalTracks(acoustic.tracks);
  const filteredTrackCount = canonicalOverride ? 0 : Math.max(0, acoustic.tracks.length - canonicalTracks.length);

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

        {canonicalTracks.length ? (
          <section className="dossier-panel dossier-panel--tracks dossier-panel--band-plank">
            <h2 className="dossier-panel-label">Canonical tracks</h2>
            {canonicalOverride?.sourceNote ? (
              <p className="dossier-provenance dossier-canonical-note">{canonicalOverride.sourceNote}</p>
            ) : filteredTrackCount > 0 ? (
              <p className="dossier-provenance dossier-canonical-note">
                {filteredTrackCount} alternate, bonus, or previously unreleased row{filteredTrackCount === 1 ? "" : "s"} kept out of this historical listening sequence.
              </p>
            ) : null}
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
