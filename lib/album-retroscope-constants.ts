export const RETROSCOPE_YEAR_MIN = 1965;
export const RETROSCOPE_YEAR_MAX = 1995;
export const RETROSCOPE_WORLD_YEAR_MIN = 1950;
export const RETROSCOPE_WORLD_YEAR_MAX = 2030;
export const RETROSCOPE_GRID_COLS = 7;
export const RETROSCOPE_GRID_ROWS = 10;
export const RETROSCOPE_RANK_MAX = 200;

export type RetroscopeCellDTO = {
  chartYear: number;
  retroverseRank: number;
  albumId: string;
  title: string;
  artist: string;
  releaseYear: number | null;
  canonicalCoverPath: string | null;
  trustState: "verified" | "provisional" | "unresolved";
  sourceNote: string | null;
};

export function retroscopeCellKey(chartYear: number, retroverseRank: number): string {
  return `${chartYear}:${retroverseRank}`;
}
