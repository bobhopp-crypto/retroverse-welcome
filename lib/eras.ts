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
