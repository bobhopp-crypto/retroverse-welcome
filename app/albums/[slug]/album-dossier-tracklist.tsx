import Link from "next/link";

import { RetroverseAcousticInstrumentation } from "@/app/albums/[slug]/retroverse-acoustic-instrumentation";
import type { DossierTrackRow } from "@/lib/album-dossier-display-tracks";
import { buildAlbumTrackSignalPresentation } from "@/lib/track-signal-presentation";
import { homeSearchHref } from "@/lib/retroverse-nav";
import { hrefForTrack } from "@/lib/retroverse-routes";

function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

type Props = {
  rows: DossierTrackRow[];
  artistName: string;
};

export function AlbumDossierTracklist({ rows, artistName }: Props) {
  if (!rows.length) {
    return <p className="dossier-provenance">Tracks not listed yet.</p>;
  }

  const presentation = buildAlbumTrackSignalPresentation(rows);

  return (
    <ol className="dossier-tracklist dossier-tracklist--editorial-signal">
      {rows.map((row, i) => {
        const tr = row.track;
        const pres = presentation[i]!;
        const trackHref =
          tr.spotify_track_id && /^RVTR\d{6}$/i.test(tr.spotify_track_id)
            ? hrefForTrack(tr.spotify_track_id)
            : homeSearchHref(`${tr.title} ${artistName}`);
        const heatClass =
          pres.heatTier !== "none" ? ` dossier-tracklist-row--heat-${pres.heatTier}` : "";
        const rankLabel =
          pres.signalRank != null ? `Album signal rank #${pres.signalRank}` : "Signal not rated";

        return (
          <li
            key={`${tr.spotify_track_id ?? tr.title}-${i}`}
            className={`dossier-tracklist-row${heatClass}`}
          >
            <div className="dossier-tracklist-glyph">
              <RetroverseAcousticInstrumentation
                presentation="track-row"
                profile={row.profile}
                retroverseDial={row.retroverseDial}
                hideCenterDial
                simplifyRing
                a11yLabel={`${tr.title}. ${rankLabel}.`}
                domIdSlug={`${i}-${tr.title.slice(0, 12)}`}
              />
              {pres.signalRank != null ? (
                <span className="dossier-tracklist-signal-rank" aria-hidden>
                  #{pres.signalRank}
                </span>
              ) : null}
            </div>
            <Link href={trackHref} className="dossier-tracklist-main">
              <span className="dossier-tracklist-num">{row.position}</span>
              <span className="dossier-tracklist-title">{tr.title}</span>
              <span className="dossier-tracklist-dur">{formatDurationMs(tr.duration_ms ?? undefined)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
