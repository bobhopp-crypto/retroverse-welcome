import Link from "next/link";

import { RetroverseAcousticInstrumentation } from "@/app/albums/[slug]/retroverse-acoustic-instrumentation";
import { TrackPlayCenter } from "@/app/albums/[slug]/track-play-center";
import type { DossierTrackRow } from "@/lib/album-dossier-display-tracks";
import type { VideoCacheDict } from "@/lib/legacy-playback/playback";
import { buildAlbumTrackSignalPresentation } from "@/lib/track-signal-presentation";
import { resolveTrackPlayState } from "@/lib/track-media-state";
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
  videoCache?: VideoCacheDict;
};

export function AlbumDossierTracklist({ rows, artistName, videoCache }: Props) {
  if (!rows.length) {
    return <p className="dossier-provenance">Tracks not listed yet.</p>;
  }

  const presentation = buildAlbumTrackSignalPresentation(rows);

  return (
    <ol className="dossier-tracklist dossier-tracklist--editorial-signal">
      {rows.map((row, i) => {
        const tr = row.track;
        const pres = presentation[i]!;
        const play = resolveTrackPlayState(artistName, tr.title, videoCache);
        const trackHref =
          tr.spotify_track_id && /^RVTR\d{6}$/i.test(tr.spotify_track_id)
            ? hrefForTrack(tr.spotify_track_id)
            : homeSearchHref(`${tr.title} ${artistName}`);
        const heatClass =
          pres.heatTier !== "none" ? ` dossier-tracklist-row--heat-${pres.heatTier}` : "";

        return (
          <li
            key={`${tr.spotify_track_id ?? tr.title}-${i}`}
            className={`dossier-tracklist-row${heatClass}`}
          >
            <div className="dossier-tracklist-instrument">
              <RetroverseAcousticInstrumentation
                presentation="track-row"
                profile={row.profile}
                hideCenterDial
                simplifyRing
                a11yLabel={`${tr.title}. Sonic readout.`}
                domIdSlug={`${i}-${tr.title.slice(0, 12)}`}
              />
              <TrackPlayCenter
                state={play.state}
                title={tr.title}
                mediaLabel={play.mediaLabel}
                playbackUrl={play.playbackUrl}
              />
            </div>
            <Link href={trackHref} className="dossier-tracklist-main">
              <span className="dossier-tracklist-title">{tr.title}</span>
              <span className="dossier-tracklist-dur">{formatDurationMs(tr.duration_ms ?? undefined)}</span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
