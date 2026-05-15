export type ChartPoint = { yearFloat: number; position: number };

export type TrailCover = { sky: string; ground: string; sun: string };

export type Trail = {
  id: string;
  title: string;
  artist: string;
  color: string;
  cover: TrailCover;
  points: ChartPoint[];
  archiveHref: string;
  artistHref: string;
  releaseYear: number | null;
  /** `canonical` = Billboard spine; `synthetic` = offline demo trails only. */
  source: "canonical" | "synthetic";
};
