import { SIGNAL_GLOBAL_END, SIGNAL_GLOBAL_START } from "./occupancy-scope";
import { MIN_OBSERVATION_SPAN_YEARS } from "./temporal-window";
import type { ChartPoint, Trail } from "./types";

export type SemanticRunKind = "canon" | "origin" | "run" | "peak" | "return" | "full";

/** Absolute year-float bounds for one semantic viewing mode (x-axis = start→end remapped to grid width). */
export type SemanticDomain = { start: number; end: number };

export type TemporalDomainBundle = {
  /** Default Retroscope window (~1960–1999) — not a toolbar lever; initial / reset state. */
  canon: SemanticDomain;
  /** Full Billboard calendar span in this build (global). */
  full: SemanticDomain;
  origin: SemanticDomain;
  run: SemanticDomain;
  peak: SemanticDomain;
  /** Secondary re-entry era only; null if none. */
  return: SemanticDomain | null;
  hasReturn: boolean;
  reentryPoints: ChartPoint[] | null;
};

/** ~5 month chart gap ends a continuous occupancy run. */
const RUN_GAP_YEARS = 0.42;
/** Minimum calendar separation (years) for a later run to count as re-entry echo. */
const REENTRY_SEPARATION_YEARS = 1.05;
const MIN_RETURN_WEEKS = 4;

const G_LO = SIGNAL_GLOBAL_START;
const G_HI = SIGNAL_GLOBAL_END;

/** Default album-era observation window (dense, culturally legible). */
const CANON_DEFAULT_LO = 1960;
const CANON_DEFAULT_HI = 1999;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sortedPoints(trail: Trail): ChartPoint[] {
  return [...trail.points].sort((a, b) => a.yearFloat - b.yearFloat);
}

function splitIntoRuns(sorted: ChartPoint[], gapYears: number): ChartPoint[][] {
  if (sorted.length === 0) return [];
  const runs: ChartPoint[][] = [];
  let cur: ChartPoint[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const p = sorted[i]!;
    if (p.yearFloat - prev.yearFloat > gapYears) {
      runs.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  runs.push(cur);
  return runs;
}

function scoreRun(run: ChartPoint[]): number {
  if (run.length === 0) return 0;
  const tSpan = run[run.length - 1]!.yearFloat - run[0]!.yearFloat;
  let inv = 0;
  for (const p of run) {
    inv += (200 - Math.min(200, p.position)) / 200;
  }
  const density = inv / run.length;
  return (tSpan + 0.08) * density * Math.log(run.length + 2);
}

export function pickPrimaryAndSecondaryRuns(trail: Trail): {
  primary: ChartPoint[];
  secondary: ChartPoint[] | null;
} {
  const sorted = sortedPoints(trail);
  if (sorted.length === 0) return { primary: [], secondary: null };
  const runs = splitIntoRuns(sorted, RUN_GAP_YEARS);
  const scored = runs.map((run) => ({ run, s: scoreRun(run) }));
  scored.sort((a, b) => b.s - a.s);
  const primary = scored[0]?.run ?? sorted;
  if (scored.length < 2) return { primary, secondary: null };
  const secondary = scored[1]!.run;
  if (secondary.length < MIN_RETURN_WEEKS) return { primary, secondary: null };
  const pLo = primary[0]!.yearFloat;
  const pHi = primary[primary.length - 1]!.yearFloat;
  const sLo = secondary[0]!.yearFloat;
  const sHi = secondary[secondary.length - 1]!.yearFloat;
  const sep = sLo > pHi ? sLo - pHi : pLo - sHi;
  if (sep < REENTRY_SEPARATION_YEARS) return { primary, secondary: null };
  return { primary, secondary };
}

/** Enforce minimum span and keep within global chart years. */
function finalizeDomain(lo: number, hi: number): SemanticDomain {
  const MIN = MIN_OBSERVATION_SPAN_YEARS;
  let a = lo;
  let b = hi;
  if (b - a < MIN) {
    const m = (a + b) / 2;
    a = m - MIN / 2;
    b = m + MIN / 2;
  }
  a = clamp(a, G_LO, G_HI - MIN);
  b = clamp(b, a + MIN, G_HI);
  return { start: a, end: b };
}

/**
 * Builds absolute temporal bounds per semantic mode. Grid x maps linearly
 * start→end to 0%→100% (coordinate remapping, not a cropped global window).
 */
export function computeTemporalDomains(trail: Trail): TemporalDomainBundle {
  const globalDomain: SemanticDomain = { start: G_LO, end: G_HI };
  const canonDomain = finalizeDomain(CANON_DEFAULT_LO, CANON_DEFAULT_HI);
  const empty: TemporalDomainBundle = {
    canon: canonDomain,
    full: globalDomain,
    origin: globalDomain,
    run: globalDomain,
    peak: globalDomain,
    return: null,
    hasReturn: false,
    reentryPoints: null,
  };
  if (trail.points.length === 0) return empty;

  const sorted = sortedPoints(trail);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const warmEnd = sorted[Math.min(8, sorted.length - 1)]!.yearFloat;

  const origin = finalizeDomain(first.yearFloat - 0.06, warmEnd + 0.18);

  const { primary, secondary } = pickPrimaryAndSecondaryRuns(trail);
  const runLo = primary.length ? primary[0]!.yearFloat : first.yearFloat;
  const runHi = primary.length ? primary[primary.length - 1]!.yearFloat : last.yearFloat;
  const run = finalizeDomain(runLo - 0.05, runHi + 0.05);

  let bestP = sorted[0]!.position;
  for (const p of sorted) bestP = Math.min(bestP, p.position);
  const band = sorted.filter((p) => p.position <= bestP + 22);
  const peakLo = band.length ? band[0]!.yearFloat : runLo;
  const peakHi = band.length ? band[band.length - 1]!.yearFloat : runHi;
  const peak = finalizeDomain(peakLo - 0.1, peakHi + 0.12);

  let retDomain: SemanticDomain | null = null;
  let reentryPoints: ChartPoint[] | null = null;
  if (secondary && secondary.length >= MIN_RETURN_WEEKS) {
    reentryPoints = secondary;
    const rLo = secondary[0]!.yearFloat;
    const rHi = secondary[secondary.length - 1]!.yearFloat;
    retDomain = finalizeDomain(rLo - 0.05, rHi + 0.05);
  }

  return {
    canon: canonDomain,
    full: globalDomain,
    origin,
    run,
    peak,
    return: retDomain,
    hasReturn: retDomain !== null,
    reentryPoints,
  };
}

export function activeTemporalDomain(
  kind: SemanticRunKind,
  domains: TemporalDomainBundle,
): SemanticDomain {
  switch (kind) {
    case "canon":
      return domains.canon;
    case "full":
      return domains.full;
    case "origin":
      return domains.origin;
    case "run":
      return domains.run;
    case "peak":
      return domains.peak;
    case "return":
      return domains.return ?? domains.run;
    default:
      return domains.canon;
  }
}

export type GhostSegment = { key: string; points: string };

export function buildReentryGhostSegments(
  reentry: ChartPoint[] | null,
  visibleStart: number,
  visibleEnd: number,
  depthToY: (position: number) => number,
): GhostSegment[] {
  if (!reentry || reentry.length < 2) return [];
  const span = visibleEnd - visibleStart;
  if (span < 1e-6) return [];
  const pts = [...reentry]
    .filter((p) => p.yearFloat >= visibleStart && p.yearFloat <= visibleEnd)
    .sort((a, b) => a.yearFloat - b.yearFloat);
  if (pts.length < 2) return [];
  const seg: string[] = [];
  for (const p of pts) {
    const x = ((p.yearFloat - visibleStart) / span) * 100;
    seg.push(`${x},${depthToY(p.position)}`);
  }
  return [{ key: "reentry-ghost", points: seg.join(" ") }];
}

/** Evenly spaced tick positions in the active domain (absolute years). */
export function domainTimelineTicks(start: number, end: number, count: number): number[] {
  const span = end - start;
  if (span < 1e-9 || count < 2) return [start, end];
  return Array.from({ length: count }, (_, i) => start + (i / (count - 1)) * span);
}
