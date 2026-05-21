import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";

import { TrackSonicMeters } from "./track-sonic-meters";

type Props = {
  title: string;
  profile: AggregatedAcousticProfile;
};

/** Track detail — horizontal sonic meters only (no play / media cluster). */
export function TrackInstrumentationStrip({ title, profile }: Props) {
  return (
    <section
      className="dossier-track-instrument-strip dossier-track-instrument-strip--meters"
      aria-label="Sonic readout"
    >
      <p className="dossier-track-instrument-caption">Track fingerprint</p>
      <TrackSonicMeters profile={profile} a11yLabel={`${title}. Sonic fingerprint.`} />
    </section>
  );
}
