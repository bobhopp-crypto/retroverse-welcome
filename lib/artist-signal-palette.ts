/**
 * Deterministic artist signal identity — frequency, not genre.
 */

export type ArtistSignalPalette = {
  hue: number;
  hueSecondary: number;
  accent: string;
  accentWarm: string;
  bloom: string;
  descriptor: string;
};

const KNOWN_FREQUENCY: Record<
  string,
  Partial<ArtistSignalPalette> & { hue: number; hueSecondary: number }
> = {
  "donna-summer": {
    hue: 312,
    hueSecondary: 186,
    descriptor: "neon pulse · disco cyan",
  },
  "fleetwood-mac": {
    hue: 28,
    hueSecondary: 198,
    descriptor: "warm/cool analog drift",
  },
  "electric-light-orchestra": {
    hue: 208,
    hueSecondary: 268,
    descriptor: "electric orchestral blue",
  },
  elo: {
    hue: 208,
    hueSecondary: 268,
    descriptor: "electric orchestral blue",
  },
  america: {
    hue: 32,
    hueSecondary: 12,
    descriptor: "dusty amber sunset",
  },
  "bee-gees": {
    hue: 285,
    hueSecondary: 165,
    descriptor: "mirror-ball spectral",
  },
  prince: {
    hue: 278,
    hueSecondary: 48,
    descriptor: "violet voltage",
  },
  "prince-and-the-revolution": {
    hue: 278,
    hueSecondary: 48,
    descriptor: "violet voltage",
  },
  "linda-ronstadt": {
    hue: 18,
    hueSecondary: 340,
    descriptor: "desert rose filament",
  },
};

function hashSlug(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

function descriptorFromMetrics(input: {
  peakMomentumScore: number;
  rankedYearCount: number;
  retroverseRank: number;
  warmth: number;
}): string {
  if (input.peakMomentumScore >= 12 && input.retroverseRank <= 3) return "dominant filament";
  if (input.rankedYearCount >= 10) return "recurrent carrier wave";
  if (input.retroverseRank <= 5) return "peak-year beacon";
  if (input.warmth > 0.55) return "warm analog bloom";
  if (input.warmth < 0.35) return "cool phosphor trail";
  return "archive signal trace";
}

function buildPalette(hue: number, hueSecondary: number, descriptor: string): ArtistSignalPalette {
  return {
    hue,
    hueSecondary,
    accent: `hsl(${hue} 72% 58%)`,
    accentWarm: `hsl(${hueSecondary} 65% 52%)`,
    bloom: `hsl(${hue} 80% 45% / 0.35)`,
    descriptor,
  };
}

export function computeArtistSignalPalette(input: {
  displayName: string;
  slug: string;
  peakMomentumScore: number;
  rankedYearCount: number;
  retroverseRank: number;
  chartYear: number;
  dominantYears: number[];
  activeYearsFirst: number | null;
  activeYearsLast: number | null;
}): ArtistSignalPalette {
  const slug = input.slug.trim().toLowerCase();
  const known = KNOWN_FREQUENCY[slug];
  if (known) {
    return buildPalette(
      known.hue,
      known.hueSecondary,
      known.descriptor ?? descriptorFromMetrics({
        peakMomentumScore: input.peakMomentumScore,
        rankedYearCount: input.rankedYearCount,
        retroverseRank: input.retroverseRank,
        warmth: 0.5,
      }),
    );
  }

  const h = hashSlug(slug);
  const dominance = Math.min(1, input.peakMomentumScore / 14);
  const density = Math.min(1, input.rankedYearCount / 14);
  const placement = Math.max(0, 1 - (input.retroverseRank - 1) / 40);

  const hue = (h % 300) + 30 + dominance * 18;
  const warmth =
    input.dominantYears.length > 0
      ? (input.dominantYears.reduce((a, y) => a + y, 0) / input.dominantYears.length - 1965) / 35
      : 0.5;
  const hueSecondary = (hue + 55 + Math.round(warmth * 80)) % 360;

  const descriptor = descriptorFromMetrics({
    peakMomentumScore: input.peakMomentumScore,
    rankedYearCount: input.rankedYearCount,
    retroverseRank: input.retroverseRank,
    warmth,
  });

  const satBoost = density * 8;
  return buildPalette(
    Math.round(hue),
    Math.round(hueSecondary),
    `${descriptor} · ${placement > 0.7 ? "high placement" : "field echo"}`,
  );
}
