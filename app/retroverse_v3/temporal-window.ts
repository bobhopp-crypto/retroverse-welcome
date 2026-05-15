import {
  SIGNAL_GLOBAL_END,
  SIGNAL_GLOBAL_RANGE,
  SIGNAL_GLOBAL_START,
} from "./occupancy-scope";

export const MIN_OBSERVATION_SPAN_YEARS = 1 / 22;
export const DEFAULT_OBSERVATION_SPAN_YEARS = 4;
/** Below this span, chart-neighborhood chips appear in the occupancy grid. */
export const CHART_NEIGHBORHOOD_SPAN_YEARS = 0.55;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function clampObservationWindow(
  centerYear: number,
  spanYears: number,
): { centerYear: number; spanYears: number } {
  const span = clamp(spanYears, MIN_OBSERVATION_SPAN_YEARS, SIGNAL_GLOBAL_RANGE);
  const half = span / 2;
  let c = clamp(centerYear, SIGNAL_GLOBAL_START + half, SIGNAL_GLOBAL_END - half);
  if (c - half < SIGNAL_GLOBAL_START) {
    c = SIGNAL_GLOBAL_START + half;
  }
  if (c + half > SIGNAL_GLOBAL_END) {
    c = SIGNAL_GLOBAL_END - half;
  }
  return { centerYear: c, spanYears: span };
}

/** Maps continuous window span → discrete renderer band (trail field / grid styling). */
export type ObservationRenderZoom = 0 | 1 | 2 | 3 | 4 | 5;

export function renderZoomFromSpan(spanYears: number): ObservationRenderZoom {
  if (spanYears >= SIGNAL_GLOBAL_RANGE * 0.95) return 0;
  if (spanYears >= 19) return 1;
  if (spanYears >= 9) return 2;
  if (spanYears >= 3.2) return 3;
  if (spanYears >= 0.52) return 4;
  return 5;
}

export function observationScaleLabel(spanYears: number): string {
  const z = renderZoomFromSpan(spanYears);
  const labels: Record<ObservationRenderZoom, string> = {
    0: "Universe",
    1: "Macro",
    2: "Decade",
    3: "Era",
    4: "Year",
    5: "Deep time",
  };
  return labels[z];
}

export function formatObservationRangeLabel(start: number, end: number, spanYears: number): string {
  if (spanYears >= 24) return `${Math.round(start)} — ${Math.round(end)}`;
  if (spanYears >= 1.35) return `${Math.round(start)} — ${Math.round(end)}`;
  if (spanYears >= 0.42) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mi = (y: number) => clamp(Math.floor((y - Math.floor(y)) * 12), 0, 11);
    const a = months[mi(start)]!;
    const b = months[mi(end)]!;
    return `${a} '${String(Math.floor(start)).slice(2)} — ${b} '${String(Math.floor(end)).slice(2)}`;
  }
  const wk = (y: number) => Math.max(1, Math.round((y - Math.floor(y)) * 52));
  return `Wk ${wk(start)} — Wk ${wk(end)}`;
}
