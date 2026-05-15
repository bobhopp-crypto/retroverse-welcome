/**
 * Materialized RetroScope corpus (`retroscope-coordinates.json` from
 * `RETROVERSE_DATA/scripts/materialize_retroscope_runtime.py`).
 */
export type RetroscopeCoordinateCell = {
  k: string;
  chartYear: number;
  chartRank: number;
  chart_date: string;
  albumId: string;
  artist: string;
  album: string;
  canonical_cover_path: string | null;
  trust_score: number;
  identity_state: string;
  trustState: string;
  source_note: string;
};

export type RetroscopeCoordinatesFile = {
  version: number;
  generated_at: string;
  source_db: string;
  year_range_present: [number, number];
  cell_count: number;
  cells: RetroscopeCoordinateCell[];
};
