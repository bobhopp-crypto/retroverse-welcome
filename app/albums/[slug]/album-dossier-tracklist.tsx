import Link from "next/link";

import { RetroverseAcousticInstrumentation } from "@/app/albums/[slug]/retroverse-acoustic-instrumentation";
import { TrackPlayCenter } from "@/app/albums/[slug]/track-play-center";
import type { DossierTrackRow } from "@/lib/album-dossier-display-tracks";
import {
  resolveAlbumTrackHref,
  type AlbumTrackRouteIndex,
} from "@/lib/load-album-track-routes";
import type { VideoCacheDict } from "@/lib/legacy-playback/playback";
import { buildAlbumTrackSignalPresentation } from "@/lib/track-signal-presentation";
import { resolveTrackPlayState } from "@/lib/track-media-state";

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
  trackRouteIndex: AlbumTrackRouteIndex;
};

export function AlbumDossierTracklist({ rows, artistName, videoCache, trackRouteIndex }: Props) {
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
        const trackHref = resolveAlbumTrackHref(tr.title, tr.spotify_track_id, trackRouteIndex);
        const navigable = Boolean(trackHref);
        const heatClass =
          pres.heatTier !== "none" ? ` dossier-tracklist-row--heat-${pres.heatTier}` : "";
        const navClass = navigable
          ? " dossier-tracklist-row--navigable"
          : " dossier-tracklist-row--static";

        return (
          <li
            key={`${tr.spotify_track_id ?? tr.title}-${i}`}
            className={`dossier-tracklist-row${heatClass}${navClass}`}
          >
            {navigable ? (
              <Link
                href={trackHref!}
                className="dossier-tracklist-row-overlay"
                aria-label={`Open ${tr.title}`}
              />
            ) : null}
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
            <div className="dossier-tracklist-main">
              <span className="dossier-tracklist-title">{tr.title}</span>
              <span className="dossier-tracklist-dur">{formatDurationMs(tr.duration_ms ?? undefined)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
