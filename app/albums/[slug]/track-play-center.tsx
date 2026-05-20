import {
  TRACK_PLAY_TRIANGLE_COLOR,
  type TrackPlayState,
} from "@/lib/track-media-state";

type Props = {
  state: TrackPlayState;
  title: string;
  mediaLabel: string;
  playbackUrl: string | null;
};

/** Center play triangle only — color reflects media state; rings stay separate. */
export function TrackPlayCenter({ state, title, mediaLabel, playbackUrl }: Props) {
  const fill = TRACK_PLAY_TRIANGLE_COLOR[state];
  const interactive = Boolean(playbackUrl);
  const a11y = `${title}. ${mediaLabel}.${interactive ? " Play." : ""}`;

  const triangle = (
    <svg
      className="dossier-track-play-svg"
      viewBox="0 0 24 24"
      aria-hidden={interactive ? undefined : true}
      aria-label={interactive ? undefined : a11y}
    >
      <path
        d="M 9 6 L 9 18 L 18 12 Z"
        fill={fill}
        opacity={state === "no_media" ? 0.5 : 0.94}
      />
    </svg>
  );

  if (!interactive) {
    return (
      <span className="dossier-track-play-center dossier-track-play-center--dormant" aria-label={a11y}>
        {triangle}
      </span>
    );
  }

  return (
    <a
      href={playbackUrl!}
      className="dossier-track-play-center dossier-track-play-center--play"
      target="_blank"
      rel="noopener noreferrer"
      aria-label={a11y}
    >
      {triangle}
    </a>
  );
}
