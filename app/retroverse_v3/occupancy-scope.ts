/** Observation window & temporal zoom (shared with validation math). */

export const SIGNAL_GLOBAL_START = 1958;
export const SIGNAL_GLOBAL_END = 2025;
export const SIGNAL_GLOBAL_RANGE = SIGNAL_GLOBAL_END - SIGNAL_GLOBAL_START;

export const DEFAULT_OBSERVATION_CENTER_YEAR = 1977;
export const DEFAULT_OBSERVATION_ZOOM_LEVEL = 3;

/** Years visible in the signal field at each zoom step (matches machine). */
export const OBSERVATION_ZOOM_SPAN_YEARS: Record<number, number> = {
  0: SIGNAL_GLOBAL_RANGE,
  1: 22,
  2: 10,
  3: 4,
  4: 1,
  5: 0.25,
};
