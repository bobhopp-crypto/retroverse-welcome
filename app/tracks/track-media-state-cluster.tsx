import { TrackPlayCenter } from "@/app/albums/[slug]/track-play-center";
import {
  TRACK_PLAY_TRIANGLE_COLOR,
  type TrackPlayState,
} from "@/lib/track-media-state";

const MEDIA_ORDER: TrackPlayState[] = [
  "vdj_video",
  "vdj_audio",
  "youtube_verified",
  "youtube_search",
];

type Props = {
  state: TrackPlayState;
  title: string;
  mediaLabel: string;
  playbackUrl: string | null;
};

function MiniPlayIcon({ slot, active }: { slot: TrackPlayState; active: boolean }) {
  const fill = TRACK_PLAY_TRIANGLE_COLOR[slot];
  return (
    <span
      className={`dossier-track-media-led dossier-track-media-led--${slot}${active ? " dossier-track-media-led--active" : ""}`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="dossier-track-media-led-svg">
        <path d="M 9 6 L 9 18 L 18 12 Z" fill={fill} opacity={active ? 0.94 : 0.26} />
      </svg>
    </span>
  );
}

/** Media availability LEDs + single play control (triangle color = active state). */
export function TrackMediaStateCluster({ state, title, mediaLabel, playbackUrl }: Props) {
  return (
    <div className="dossier-track-media-cluster" aria-label="Playback sources">
      <div className="dossier-track-media-leds" aria-hidden>
        {MEDIA_ORDER.map((slot) => (
          <MiniPlayIcon key={slot} slot={slot} active={slot === state} />
        ))}
      </div>
      <div className="dossier-track-media-play">
        <TrackPlayCenter
          state={state}
          title={title}
          mediaLabel={mediaLabel}
          playbackUrl={playbackUrl}
        />
      </div>
    </div>
  );
}
