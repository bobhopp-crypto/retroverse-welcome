import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";
import { buildTrackSonicMeters } from "@/lib/track-sonic-metrics";

type Props = {
  profile: AggregatedAcousticProfile;
  a11yLabel: string;
};

/** Track detail page only — horizontal vintage console meters (not circular rings). */
export function TrackSonicMeters({ profile, a11yLabel }: Props) {
  const meters = buildTrackSonicMeters(profile);
  const summary = meters.map((m) => `${m.label} ${m.readout}%`).join(". ");

  return (
    <figure className="dossier-track-sonic-meters" role="img" aria-label={`${a11yLabel} ${summary}`}>
      <ul className="dossier-track-sonic-meters-list">
        {meters.map((meter) => (
          <li key={meter.key} className="dossier-sonic-meter-row">
            <span className="dossier-sonic-meter-label">{meter.label}</span>
            <div
              className="dossier-sonic-meter-well"
              title={`${meter.label} ${meter.readout}%`}
              style={{ ["--meter-track" as string]: meter.track }}
            >
              <span className="dossier-sonic-meter-track" aria-hidden />
              <span
                className="dossier-sonic-meter-fill"
                style={{
                  width: `${meter.pct}%`,
                  background: meter.fill,
                  ["--meter-glow" as string]: meter.glow,
                }}
                aria-hidden
              />
              <span className="dossier-sonic-meter-ticks" aria-hidden>
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
            <span className="dossier-sonic-meter-readout" aria-hidden>
              {meter.readout}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
