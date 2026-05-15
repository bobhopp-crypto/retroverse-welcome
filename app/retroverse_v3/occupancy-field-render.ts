import type { ObservationRenderZoom as ZoomLevel } from "./temporal-window";
import type { ChartPoint } from "./types";

export type TrailFieldMode = "signal" | "hybrid" | "observation";

/** Line layer weight: Universe = heat-first mist; Week = precise trace. */
export type TrailLinePreset = "atmospheric" | "transitional" | "precise";

export type TrailSegmentSpec = { key: string; points: string };

export type TrailDotSpec = {
  x: number;
  y: number;
  year: number;
  r: number;
  opacity: number;
};

/** Temporal occupancy heat (Universe / soft Macro) — ellipses, not chart polylines. */
export type TrailHeatBlob = {
  key: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  opacity: number;
};

/** ~20 days: consecutive canonical chart weeks are ~7d apart; larger gap starts a new polyline (off-chart / re-entry). */
const WEEKLY_CHART_TRAIL_GAP_YEARS = 0.055;

/** Slightly tighter than Macro so re-entries read as separate islands at Universe scale. */
const UNIVERSE_RUN_GAP_YEARS = 2.35;
const HYBRID_RUN_GAP_YEARS = 2.85;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function splitIntoTimeRuns(sorted: ChartPoint[], gapYears: number): ChartPoint[][] {
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

/**
 * Per-chart-run temporal heat + faint “mist” polylines inside each island only
 * (no stitching across re-entry gaps).
 */
function buildUniverseHeatAndMist(
  points: ChartPoint[],
  visibleStart: number,
  visibleEnd: number,
  visibleSpan: number,
  depthToY: (position: number) => number,
  runGapYears: number,
  hybrid: boolean,
): { heat: TrailHeatBlob[]; mistSegments: TrailSegmentSpec[] } {
  const sorted = [...points].sort((a, b) => a.yearFloat - b.yearFloat);
  const runs = splitIntoTimeRuns(sorted, runGapYears);
  const heat: TrailHeatBlob[] = [];
  const mistSegments: TrailSegmentSpec[] = [];
  let heatId = 0;
  let mistId = 0;

  const heatOpacityScale = hybrid ? 0.72 : 1;
  const rxScale = hybrid ? 0.88 : 1;

  for (const run of runs) {
    if (run.length === 0) continue;
    const tRunLo = run[0]!.yearFloat;
    const tRunHi = run[run.length - 1]!.yearFloat;
    const t0 = Math.max(visibleStart, tRunLo);
    const t1 = Math.min(visibleEnd, tRunHi);
    if (t1 - t0 < 1e-6) continue;

    const runSpanYears = t1 - t0;
    const innerBins = clamp(Math.round(runSpanYears / (hybrid ? 0.38 : 0.52)), 5, hybrid ? 52 : 68);

    type RB = { minP: number; maxP: number; count: number; tSum: number };
    const rb: RB[] = Array.from({ length: innerBins }, () => ({
      minP: Infinity,
      maxP: -Infinity,
      count: 0,
      tSum: 0,
    }));

    for (const pt of run) {
      if (pt.yearFloat < visibleStart || pt.yearFloat > visibleEnd) continue;
      const u = (pt.yearFloat - t0) / Math.max(1e-9, t1 - t0);
      const bi = clamp(Math.floor(u * innerBins), 0, innerBins - 1);
      const cell = rb[bi]!;
      cell.count++;
      cell.minP = Math.min(cell.minP, pt.position);
      cell.maxP = Math.max(cell.maxP, pt.position);
      cell.tSum += pt.yearFloat;
    }

    let maxC = 0;
    for (const c of rb) if (c.count > maxC) maxC = c.count;
    if (maxC === 0) continue;

    const binScreenWidth = ((t1 - t0) / Math.max(1e-9, visibleSpan)) * (100 / innerBins);
    const mistBuf: string[] = [];

    for (let bi = 0; bi < innerBins; bi++) {
      const c = rb[bi]!;
      if (c.count === 0) continue;
      const tCenter = c.tSum / c.count;
      const cx = ((tCenter - visibleStart) / Math.max(1e-9, visibleSpan)) * 100;
      const yPeak = depthToY(c.minP);
      const yDeep = depthToY(c.maxP);
      const cy = (yPeak + yDeep) / 2;
      const band = Math.abs(yDeep - yPeak);
      const dens = c.count / maxC;
      const rx = Math.max(0.28, binScreenWidth * 0.62 * rxScale);
      const ry = Math.max(0.95, band * 0.42 + 0.55 * dens * 4.2 + (hybrid ? 0.35 : 0.55));

      const opBase = hybrid ? 0.055 : 0.07;
      const opRange = hybrid ? 0.26 : 0.36;
      heat.push({
        key: `heat-${heatId++}`,
        cx,
        cy,
        rx,
        ry,
        opacity: (opBase + dens * opRange) * heatOpacityScale,
      });

      mistBuf.push(`${cx},${yPeak}`);
    }

    if (mistBuf.length >= 2) {
      mistSegments.push({ key: `mist-${mistId++}`, points: mistBuf.join(" ") });
    } else if (mistBuf.length === 1) {
      const only = mistBuf[0]!;
      mistSegments.push({ key: `mist-${mistId++}`, points: `${only} ${only}` });
    }
  }

  return { heat, mistSegments };
}

function observationGapYears(zoom: ZoomLevel): number {
  if (zoom <= 3) return 1.08;
  if (zoom === 4) return 0.52;
  return 0.26;
}

function buildObservationPaths(
  points: ChartPoint[],
  visibleStart: number,
  visibleEnd: number,
  visibleSpan: number,
  depthToY: (position: number) => number,
  gapYears: number,
): { segments: TrailSegmentSpec[]; dots: TrailDotSpec[] } {
  const gap = Math.min(gapYears, WEEKLY_CHART_TRAIL_GAP_YEARS);
  const vis = points
    .filter((p) => p.yearFloat >= visibleStart && p.yearFloat <= visibleEnd)
    .sort((a, b) => a.yearFloat - b.yearFloat);

  const segments: TrailSegmentSpec[] = [];
  const dots: TrailDotSpec[] = [];
  let buf: string[] = [];
  let segIdx = 0;

  const flushBuf = () => {
    if (buf.length >= 2) {
      segments.push({ key: `obs-${segIdx++}`, points: buf.join(" ") });
    } else if (buf.length === 1) {
      const only = buf[0]!;
      segments.push({ key: `obs-${segIdx++}`, points: `${only} ${only}` });
    }
    buf = [];
  };

  for (let i = 0; i < vis.length; i++) {
    const p = vis[i]!;
    if (i > 0) {
      const prev = vis[i - 1]!;
      if (p.yearFloat - prev.yearFloat > gap) {
        flushBuf();
      }
    }
    const x = ((p.yearFloat - visibleStart) / Math.max(1e-9, visibleSpan)) * 100;
    const y = depthToY(p.position);
    buf.push(`${x},${y}`);
    dots.push({ x, y, year: p.yearFloat, r: 0.65, opacity: 0.92 });
  }
  flushBuf();

  return { segments, dots };
}

function trailFieldModeForZoom(zoom: ZoomLevel): TrailFieldMode {
  if (zoom === 0) return "signal";
  if (zoom === 1) return "hybrid";
  return "observation";
}

function trailLinePresetForZoom(zoom: ZoomLevel): TrailLinePreset {
  if (zoom === 0) return "atmospheric";
  if (zoom === 1 || zoom === 2 || zoom === 3) return "transitional";
  return "precise";
}

export type TrailFieldPresentation = {
  mode: TrailFieldMode;
  linePreset: TrailLinePreset;
  /** Universe / hybrid: occupancy heat; null when precise-only. */
  heatBlobs: TrailHeatBlob[] | null;
  /** Universe: faint intra-island mist; hybrid: gap-broken real chart points; observation: primary segments. */
  segments: TrailSegmentSpec[];
  /** Mist / ghost polylines (Universe + hybrid); empty in observation. */
  mistSegments: TrailSegmentSpec[];
  dots: TrailDotSpec[];
};

/**
 * Time-tuning field: Universe = temporal heat + islands; Macro = heat + emerging trace;
 * zoomed = windowed occupancy with gap-broken polylines.
 */
export function buildTrailFieldPresentation(
  zoomLevel: ZoomLevel,
  points: ChartPoint[],
  visibleStart: number,
  visibleEnd: number,
  visibleSpan: number,
  depthToY: (position: number) => number,
): TrailFieldPresentation {
  const empty = (): TrailFieldPresentation => ({
    mode: trailFieldModeForZoom(zoomLevel),
    linePreset: trailLinePresetForZoom(zoomLevel),
    heatBlobs: null,
    segments: [],
    mistSegments: [],
    dots: [],
  });

  if (points.length === 0) return empty();

  if (zoomLevel === 0) {
    const { heat, mistSegments } = buildUniverseHeatAndMist(
      points,
      visibleStart,
      visibleEnd,
      visibleSpan,
      depthToY,
      UNIVERSE_RUN_GAP_YEARS,
      false,
    );
    return {
      mode: "signal",
      linePreset: "atmospheric",
      heatBlobs: heat,
      segments: [],
      mistSegments,
      dots: [],
    };
  }

  if (zoomLevel === 1) {
    const { heat, mistSegments } = buildUniverseHeatAndMist(
      points,
      visibleStart,
      visibleEnd,
      visibleSpan,
      depthToY,
      HYBRID_RUN_GAP_YEARS,
      true,
    );
    const { segments, dots } = buildObservationPaths(
      points,
      visibleStart,
      visibleEnd,
      visibleSpan,
      depthToY,
      observationGapYears(3),
    );
    return {
      mode: "hybrid",
      linePreset: "transitional",
      heatBlobs: heat,
      segments,
      mistSegments,
      dots,
    };
  }

  const obs = buildObservationPaths(
    points,
    visibleStart,
    visibleEnd,
    visibleSpan,
    depthToY,
    observationGapYears(zoomLevel),
  );

  return {
    mode: "observation",
    linePreset: trailLinePresetForZoom(zoomLevel),
    heatBlobs: null,
    segments: obs.segments,
    mistSegments: [],
    dots: obs.dots,
  };
}
