import { TrackPlayCenter } from "@/app/albums/[slug]/track-play-center";
import {
  TRACK_PLAY_TRIANGLE_COLOR,
  resolveTrackMediaAvailability,
  type TrackMediaSlot,
  type TrackPlayState,
} from "@/lib/track-media-state";
import type { VideoCacheDict } from "@/lib/legacy-playback/playback";

const VDJ_SLOTS: TrackMediaSlot[] = ["vdj_video", "vdj_audio"];
const YT_SLOTS: TrackMediaSlot[] = ["youtube_verified", "youtube_search"];

type Props = {
  state: TrackPlayState;
  title: string;
  mediaLabel: string;
  playbackUrl: string | null;
  artist: string;
  videoCache: VideoCacheDict;
};

function MediaSlotBezel({
  slot,
  active,
  available,
}: {
  slot: TrackMediaSlot;
  active: boolean;
  available: boolean;
}) {
  if (!available) return null;
  const fill = TRACK_PLAY_TRIANGLE_COLOR[slot];
  return (
    <span
      className={`dossier-track-media-slot dossier-track-media-slot--${slot}${active ? " dossier-track-media-slot--active" : ""}`}
      title={slot.replace(/_/g, " ")}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" className="dossier-track-media-slot-svg" aria-hidden>
        <path d="M 9 6 L 9 18 L 18 12 Z" fill={fill} opacity={active ? 0.96 : 0.34} />
      </svg>
    </span>
  );
}

function MediaGroup({
  label,
  slots,
  active,
  availability,
}: {
  label: string;
  slots: TrackMediaSlot[];
  active: TrackPlayState;
  availability: ReturnType<typeof resolveTrackMediaAvailability>;
}) {
  const visible = slots.filter((slot) => availability[slot]);
  if (!visible.length) return null;

  return (
    <div className={`dossier-track-media-group dossier-track-media-group--${label.toLowerCase()}`}>
      <span className="dossier-track-media-group-etch" aria-hidden>
        {label}
      </span>
      <div className="dossier-track-media-slots">
        {visible.map((slot) => (
          <MediaSlotBezel key={slot} slot={slot} active={slot === active} available />
        ))}
      </div>
    </div>
  );
}

/** VDJ / YT source bezels + primary play control (triangle color = active state). */
export function TrackMediaStateCluster({ state, title, mediaLabel, playbackUrl, artist, videoCache }: Props) {
  const availability = resolveTrackMediaAvailability(artist, title, videoCache);

  return (
    <div className="dossier-track-media-cluster" aria-label="Playback sources">
      <div className="dossier-track-media-groups">
        <MediaGroup label="VDJ" slots={VDJ_SLOTS} active={state} availability={availability} />
        <MediaGroup label="YT" slots={YT_SLOTS} active={state} availability={availability} />
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
