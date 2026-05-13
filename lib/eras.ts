import erasRaw from "@/data/eras.json";

export type EraSections = {
  dominantGenres: string;
  radioAtmosphere: string;
  chartBehavior: string;
  technologyMedia: string;
  culturalMood: string;
  definingArtists: string;
  transitionFromPrevious: string;
  whatMakesItDistinct: string;
};

export type EraYearEntry = {
  year: number;
  "Defining Musical Traits"?: string;
  "Emotional Atmosphere"?: string;
  "Chart/Radio Identity"?: string;
  "Major Transitions"?: string;
  "Notable Cultural Moments"?: string;
  "Dominant Sounds"?: string;
  "Artist Breakthroughs"?: string;
};

export type EraRecord = {
  slug: string;
  years: string;
  title: string;
  subtitle: string;
  summary: string;
  accent?: string;
  sections: EraSections;
  definingAlbums?: string[];
  definingSongs?: string[];
  chronology?: EraYearEntry[];
};

const eras = erasRaw.eras as EraRecord[];

export function getAllEras(): EraRecord[] {
  return eras;
}

export function getEraBySlug(slug: string): EraRecord | undefined {
  return eras.find((era) => era.slug === slug);
}

/** Parse `years` like "1962-1965" into inclusive bounds. */
export function eraReleaseYearBounds(era: EraRecord): { min: number; max: number } | null {
  const parts = era.years
    .split("-")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const a = Number.parseInt(parts[0]!, 10);
  const b = Number.parseInt(parts[1]!, 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { min: Math.min(a, b), max: Math.max(a, b) };
}
