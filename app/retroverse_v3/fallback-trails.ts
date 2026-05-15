import { chartRankFromRaw } from "./occupancy-chart-math";
import type { ChartPoint, Trail, TrailCover } from "./types";

type Segment = { year: number; peak: number; months: number; fluctuation: number };

type Canonical = {
  id: string;
  title: string;
  artist: string;
  color: string;
  cover: TrailCover;
  releaseYear: number;
  segments: Segment[];
};

/**
 * Curated US Billboard 200 chart-history canonicals. Each segment is a year of
 * activity (peak position + months at that peak band + observed fluctuation).
 * The renderer expands each segment into one point per chart month at the
 * segment’s peak rank only (no synthetic fluctuation). Ranks are Billboard
 * 200–only (1–200). Used when Supabase chart_appearances is unavailable.
 */
const canonicals: Canonical[] = [
  {
    id: "sgt-pepper",
    title: "Sgt. Pepper's Lonely Hearts Club Band",
    artist: "The Beatles",
    color: "#f4b449",
    cover: { sky: "#284d63", ground: "#a73e2a", sun: "#f6c956" },
    releaseYear: 1967,
    segments: [
      { year: 1967, peak: 1, months: 8, fluctuation: 2 },
      { year: 1968, peak: 22, months: 12, fluctuation: 12 },
    ],
  },
  {
    id: "bridge",
    title: "Bridge over Troubled Water",
    artist: "Simon & Garfunkel",
    color: "#f4c25e",
    cover: { sky: "#27424f", ground: "#a2602f", sun: "#efc265" },
    releaseYear: 1970,
    segments: [
      { year: 1970, peak: 1, months: 11, fluctuation: 2 },
      { year: 1971, peak: 14, months: 12, fluctuation: 9 },
      { year: 1972, peak: 90, months: 6, fluctuation: 32 },
    ],
  },
  {
    id: "tapestry",
    title: "Tapestry",
    artist: "Carole King",
    color: "#f5b66a",
    cover: { sky: "#3a2733", ground: "#b66236", sun: "#f0c558" },
    releaseYear: 1971,
    segments: [
      { year: 1971, peak: 1, months: 12, fluctuation: 3 },
      { year: 1972, peak: 10, months: 12, fluctuation: 5 },
      { year: 1973, peak: 60, months: 10, fluctuation: 26 },
    ],
  },
  {
    id: "dark-side",
    title: "The Dark Side of the Moon",
    artist: "Pink Floyd",
    color: "#f1a046",
    cover: { sky: "#1a1a23", ground: "#2a1d10", sun: "#f1c25a" },
    releaseYear: 1973,
    segments: Array.from({ length: 16 }, (_, i) => ({
      year: 1973 + i,
      peak: 95 + Math.round(Math.sin((i + 1) * 0.7) * 22),
      months: 12,
      fluctuation: 44,
    })),
  },
  {
    id: "hotel-california",
    title: "Hotel California",
    artist: "Eagles",
    color: "#f6c25c",
    cover: { sky: "#2a3a4e", ground: "#a5512c", sun: "#f3c66a" },
    releaseYear: 1976,
    segments: [
      { year: 1976, peak: 1, months: 8, fluctuation: 3 },
      { year: 1977, peak: 11, months: 12, fluctuation: 7 },
      { year: 1978, peak: 44, months: 10, fluctuation: 18 },
    ],
  },
  {
    id: "rumours",
    title: "Rumours",
    artist: "Fleetwood Mac",
    color: "#f5a14e",
    cover: { sky: "#23303e", ground: "#a9502a", sun: "#f0bb55" },
    releaseYear: 1977,
    segments: [
      { year: 1977, peak: 1, months: 12, fluctuation: 2 },
      { year: 1978, peak: 5, months: 12, fluctuation: 4 },
      { year: 1979, peak: 44, months: 10, fluctuation: 20 },
    ],
  },
  {
    id: "snf",
    title: "Saturday Night Fever",
    artist: "Bee Gees / Various",
    color: "#f6d057",
    cover: { sky: "#101632", ground: "#c95a2a", sun: "#f6cb52" },
    releaseYear: 1977,
    segments: [
      { year: 1977, peak: 1, months: 6, fluctuation: 2 },
      { year: 1978, peak: 1, months: 12, fluctuation: 2 },
      { year: 1979, peak: 36, months: 8, fluctuation: 14 },
    ],
  },
  {
    id: "back-in-black",
    title: "Back in Black",
    artist: "AC/DC",
    color: "#f1a04a",
    cover: { sky: "#1c1a1f", ground: "#3a2628", sun: "#e5b153" },
    releaseYear: 1980,
    segments: [
      { year: 1980, peak: 4, months: 10, fluctuation: 5 },
      { year: 1981, peak: 22, months: 12, fluctuation: 11 },
      { year: 1982, peak: 84, months: 10, fluctuation: 36 },
    ],
  },
  {
    id: "thriller",
    title: "Thriller",
    artist: "Michael Jackson",
    color: "#f8d05a",
    cover: { sky: "#1d1d2a", ground: "#8a3220", sun: "#f3c45a" },
    releaseYear: 1982,
    segments: [
      { year: 1982, peak: 5, months: 4, fluctuation: 3 },
      { year: 1983, peak: 1, months: 12, fluctuation: 1 },
      { year: 1984, peak: 6, months: 12, fluctuation: 5 },
      { year: 1985, peak: 28, months: 10, fluctuation: 12 },
    ],
  },
  {
    id: "born-usa",
    title: "Born in the U.S.A.",
    artist: "Bruce Springsteen",
    color: "#f0a14a",
    cover: { sky: "#1d2742", ground: "#a23a26", sun: "#f1c660" },
    releaseYear: 1984,
    segments: [
      { year: 1984, peak: 1, months: 8, fluctuation: 2 },
      { year: 1985, peak: 6, months: 12, fluctuation: 4 },
      { year: 1986, peak: 34, months: 12, fluctuation: 18 },
    ],
  },
  {
    id: "joshua-tree",
    title: "The Joshua Tree",
    artist: "U2",
    color: "#f4a45a",
    cover: { sky: "#1c2a3b", ground: "#b35a30", sun: "#f3c357" },
    releaseYear: 1987,
    segments: [
      { year: 1987, peak: 1, months: 12, fluctuation: 3 },
      { year: 1988, peak: 14, months: 12, fluctuation: 7 },
    ],
  },
  {
    id: "appetite",
    title: "Appetite for Destruction",
    artist: "Guns N' Roses",
    color: "#f29b48",
    cover: { sky: "#1a1a1a", ground: "#7e2620", sun: "#f0a247" },
    releaseYear: 1987,
    segments: [
      { year: 1987, peak: 110, months: 6, fluctuation: 50 },
      { year: 1988, peak: 1, months: 12, fluctuation: 5 },
      { year: 1989, peak: 24, months: 12, fluctuation: 14 },
    ],
  },
  {
    id: "nevermind",
    title: "Nevermind",
    artist: "Nirvana",
    color: "#f3a54a",
    cover: { sky: "#13354c", ground: "#6c4a25", sun: "#e9b350" },
    releaseYear: 1991,
    segments: [
      { year: 1991, peak: 148, months: 3, fluctuation: 70 },
      { year: 1992, peak: 1, months: 12, fluctuation: 4 },
      { year: 1993, peak: 34, months: 12, fluctuation: 18 },
    ],
  },
  {
    id: "cracked",
    title: "Cracked Rear View",
    artist: "Hootie & the Blowfish",
    color: "#f4b95a",
    cover: { sky: "#26323d", ground: "#a8682d", sun: "#f1c45e" },
    releaseYear: 1994,
    segments: [
      { year: 1994, peak: 56, months: 6, fluctuation: 28 },
      { year: 1995, peak: 1, months: 12, fluctuation: 3 },
      { year: 1996, peak: 18, months: 12, fluctuation: 11 },
    ],
  },
  {
    id: "come-on-over",
    title: "Come On Over",
    artist: "Shania Twain",
    color: "#f5be63",
    cover: { sky: "#321e35", ground: "#b2542a", sun: "#f4c456" },
    releaseYear: 1997,
    segments: [
      { year: 1997, peak: 14, months: 6, fluctuation: 6 },
      { year: 1998, peak: 1, months: 12, fluctuation: 4 },
      { year: 1999, peak: 6, months: 12, fluctuation: 4 },
      { year: 2000, peak: 56, months: 12, fluctuation: 22 },
    ],
  },
  {
    id: "millennium",
    title: "Millennium",
    artist: "Backstreet Boys",
    color: "#f4b758",
    cover: { sky: "#1f2a3c", ground: "#8c4426", sun: "#f4b754" },
    releaseYear: 1999,
    segments: [
      { year: 1999, peak: 1, months: 12, fluctuation: 4 },
      { year: 2000, peak: 28, months: 12, fluctuation: 14 },
    ],
  },
  {
    id: "21-adele",
    title: "21",
    artist: "Adele",
    color: "#f4c45a",
    cover: { sky: "#2a2a2a", ground: "#623822", sun: "#e9b660" },
    releaseYear: 2011,
    segments: [
      { year: 2011, peak: 1, months: 12, fluctuation: 2 },
      { year: 2012, peak: 1, months: 12, fluctuation: 3 },
      { year: 2013, peak: 22, months: 12, fluctuation: 12 },
    ],
  },
  {
    id: "1989",
    title: "1989",
    artist: "Taylor Swift",
    color: "#f4cf6a",
    cover: { sky: "#26344e", ground: "#a64432", sun: "#f0c163" },
    releaseYear: 2014,
    segments: [
      { year: 2014, peak: 1, months: 6, fluctuation: 2 },
      { year: 2015, peak: 5, months: 12, fluctuation: 4 },
      { year: 2016, peak: 38, months: 8, fluctuation: 18 },
    ],
  },
  {
    id: "lemonade",
    title: "Lemonade",
    artist: "Beyoncé",
    color: "#f3a44a",
    cover: { sky: "#1c1818", ground: "#6f2b27", sun: "#e6a14d" },
    releaseYear: 2016,
    segments: [
      { year: 2016, peak: 1, months: 9, fluctuation: 3 },
      { year: 2017, peak: 34, months: 12, fluctuation: 16 },
    ],
  },
  {
    id: "midnights",
    title: "Midnights",
    artist: "Taylor Swift",
    color: "#f4c95d",
    cover: { sky: "#15273f", ground: "#8a4226", sun: "#f3c75a" },
    releaseYear: 2022,
    segments: [
      { year: 2022, peak: 1, months: 6, fluctuation: 2 },
      { year: 2023, peak: 5, months: 12, fluctuation: 4 },
      { year: 2024, peak: 30, months: 12, fluctuation: 14 },
    ],
  },
];

function expandSegments(segments: Segment[]): ChartPoint[] {
  const points: ChartPoint[] = [];
  for (const segment of segments) {
    const peak = chartRankFromRaw(segment.peak);
    if (peak === null) continue;
    const months = Math.max(1, Math.min(12, Math.round(segment.months)));
    for (let m = 0; m < months; m++) {
      points.push({ yearFloat: segment.year + (m + 0.5) / 12, position: peak });
    }
  }
  return points.sort((a, b) => a.yearFloat - b.yearFloat);
}

function slugify(value: string): string {
  return encodeURIComponent(value.trim());
}

export const fallbackTrails: Trail[] = canonicals.map((c) => ({
  id: c.id,
  title: c.title,
  artist: c.artist,
  color: c.color,
  cover: c.cover,
  releaseYear: c.releaseYear,
  points: expandSegments(c.segments),
  archiveHref: `/search?q=${slugify(c.title)}`,
  artistHref: `/search?q=${slugify(c.artist)}`,
  source: "synthetic",
}));
