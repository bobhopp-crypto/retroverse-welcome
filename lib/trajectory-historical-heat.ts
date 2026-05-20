import type { TrackTrajectoryWeek } from "@/lib/load-track-trajectory";

export type TrajectoryHistoricalHeat = {
  intensity: number;
  atmosphereBg: string;
  atmosphereBorder: string;
  atmosphereGlow: string;
  railTint: string;
  barFill: string;
};

type Rgb = { r: number; g: number; b: number };

const HEAT_STOPS: Array<Rgb & { t: number }> = [
  { t: 0, r: 42, g: 128, b: 98 },
  { t: 0.32, r: 118, g: 168, b: 72 },
  { t: 0.52, r: 214, g: 186, b: 62 },
  { t: 0.72, r: 232, g: 128, b: 48 },
  { t: 1, r: 228, g: 68, b: 38 },
];

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function heatRgb(intensity: number): Rgb {
  const t = clamp01(intensity);
  for (let i = 0; i < HEAT_STOPS.length - 1; i += 1) {
    const left = HEAT_STOPS[i];
    const right = HEAT_STOPS[i + 1];
    if (t >= left.t && t <= right.t) {
      const local = (t - left.t) / (right.t - left.t);
      return {
        r: Math.round(lerp(left.r, right.r, local)),
        g: Math.round(lerp(left.g, right.g, local)),
        b: Math.round(lerp(left.b, right.b, local)),
      };
    }
  }
  const last = HEAT_STOPS[HEAT_STOPS.length - 1];
  return { r: last.r, g: last.g, b: last.b };
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp01(alpha)})`;
}

/** Cultural-moment heat for one week in the full chart run (not per-bar fill). */
export function resolveTrajectoryHistoricalHeat(
  week: TrackTrajectoryWeek,
  index: number,
  weeks: TrackTrajectoryWeek[],
  trackPeak: number | null,
): TrajectoryHistoricalHeat {
  const peak = trackPeak ?? Math.min(...weeks.map((row) => row.rank));
  const rank = week.rank;

  const strength = (101 - rank) / 100;

  let momentum = 0;
  if (week.movement === "up" && week.delta != null) momentum = Math.min(0.16, week.delta / 22);
  if (week.movement === "down" && week.delta != null) momentum = -Math.min(0.18, Math.abs(week.delta) / 18);
  if (week.movement === "reentry") momentum = 0.05;

  const peakNearness =
    rank <= peak ? 1 : Math.max(0, 1 - (rank - peak) / 35);

  let dominance = 0;
  if (rank === 1) dominance = 0.3;
  else if (rank <= 3) dominance = 0.2;
  else if (rank <= 10) dominance = 0.13;
  else if (rank <= 40) dominance = 0.07;

  let topTenStreak = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (weeks[i].rank <= 10) topTenStreak += 1;
    else break;
  }
  let numberOneStreak = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (weeks[i].rank === 1) numberOneStreak += 1;
    else break;
  }
  const sustained =
    rank <= 10 ? Math.min(0.1, topTenStreak * 0.012) : 0;
  const peakHold =
    rank === 1 ? Math.min(0.14, numberOneStreak * 0.022) : 0;

  let intensity =
    strength * 0.48 + peakNearness * 0.24 + dominance + momentum + sustained + peakHold;

  if (week.movement === "down") {
    if (rank > 50) intensity -= 0.12;
    else if (rank > 25) intensity -= 0.07;
    else intensity -= 0.03;
  }

  intensity = clamp01(intensity);
  const rgb = heatRgb(intensity);

  return {
    intensity,
    atmosphereBg: rgba(rgb, 0.1 + intensity * 0.16),
    atmosphereBorder: rgba(rgb, 0.2 + intensity * 0.28),
    atmosphereGlow: rgba(rgb, 0.08 + intensity * 0.22),
    railTint: rgba(rgb, 0.14 + intensity * 0.12),
    barFill: rgba(rgb, 0.42 + intensity * 0.38),
  };
}
