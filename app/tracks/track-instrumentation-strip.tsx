import { RetroverseAcousticInstrumentation } from "@/app/albums/[slug]/retroverse-acoustic-instrumentation";
import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";
import { loadLegacyVideoCache } from "@/lib/legacy-playback/video-cache";
import { resolveTrackPlayState } from "@/lib/track-media-state";

import { TrackMediaStateCluster } from "./track-media-state-cluster";

type Props = {
  artist: string;
  title: string;
  profile: AggregatedAcousticProfile;
  retroverseTrackId?: string | null;
};

export async function TrackInstrumentationStrip({
  artist,
  title,
  profile,
  retroverseTrackId,
}: Props) {
  const { cache } = await loadLegacyVideoCache();
  const play = resolveTrackPlayState(artist, title, cache);

  return (
    <section className="dossier-track-instrument-strip" aria-label="Track instrumentation">
      <div className="dossier-track-instrument-sonic">
        <RetroverseAcousticInstrumentation
          presentation="instrument-strip"
          profile={profile}
          hideCenterDial
          simplifyRing
          a11yLabel={`${title}. Sonic fingerprint.`}
          domIdSlug={`strip-${title.slice(0, 10)}`}
        />
      </div>
      <TrackMediaStateCluster
        state={play.state}
        title={title}
        mediaLabel={play.mediaLabel}
        playbackUrl={play.playbackUrl}
      />
    </section>
  );
}
