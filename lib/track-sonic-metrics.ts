import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";

function clamp01(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function mean01(...vals: Array<number | null | undefined>): number {
  const ok = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (!ok.length) return 0;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

/** Cultural presence — broadcast/liveness pulse (same source as dossier rings). */
export function culturalPresenceMetric(profile: AggregatedAcousticProfile): number {
  return clamp01(mean01(profile.liveness, profile.speechiness, profile.danceability));
}

function fmtPct(n: number): string {
  return `${Math.round(n * 100)}`;
}

export type TrackSonicMeter = {
  key: string;
  label: string;
  value: number;
  pct: number;
  readout: string;
  track: string;
  fill: string;
  glow: string;
};

/** Four horizontal meters for the track detail instrumentation strip. */
export function buildTrackSonicMeters(profile: AggregatedAcousticProfile): TrackSonicMeter[] {
  return [
    {
      key: "energy",
      label: "Energy",
      value: clamp01(profile.energy),
      pct: Math.round(clamp01(profile.energy) * 100),
      readout: fmtPct(clamp01(profile.energy)),
      track: "rgba(232,107,79,0.14)",
      fill: "linear-gradient(90deg, rgba(232,107,79,0.55), rgba(232,107,79,0.88))",
      glow: "rgba(232,107,79,0.35)",
    },
    {
      key: "danceability",
      label: "Danceability",
      value: clamp01(profile.danceability),
      pct: Math.round(clamp01(profile.danceability) * 100),
      readout: fmtPct(clamp01(profile.danceability)),
      track: "rgba(255,200,120,0.14)",
      fill: "linear-gradient(90deg, rgba(255,200,120,0.5), rgba(255,200,120,0.86))",
      glow: "rgba(255,200,120,0.32)",
    },
    {
      key: "mood",
      label: "Mood",
      value: clamp01(profile.valence),
      pct: Math.round(clamp01(profile.valence) * 100),
      readout: fmtPct(clamp01(profile.valence)),
      track: "rgba(199,107,143,0.14)",
      fill: "linear-gradient(90deg, rgba(199,107,143,0.5), rgba(199,107,143,0.88))",
      glow: "rgba(199,107,143,0.32)",
    },
    {
      key: "presence",
      label: "Presence",
      value: culturalPresenceMetric(profile),
      pct: Math.round(culturalPresenceMetric(profile) * 100),
      readout: fmtPct(culturalPresenceMetric(profile)),
      track: "rgba(94,196,207,0.14)",
      fill: "linear-gradient(90deg, rgba(94,196,207,0.48), rgba(94,196,207,0.84))",
      glow: "rgba(94,196,207,0.3)",
    },
  ];
}
