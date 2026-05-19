export type SignalTier = "primary" | "related" | "archive";

export type TrackSignalInput = {
  title: string;
  peakChartPosition?: number | null;
  chartWeeks?: number | null;
};

export type CuratedTrackSignal<T extends TrackSignalInput> = T & {
  signalTier: SignalTier;
  signalScore: number;
  signalKey: string;
  signalReason: string;
};

const VARIANT_PATTERN =
  /\b(live|remaster(?:ed)?|mono|stereo|demo|session|sessions|rough|roughs|outtake|outtakes|alternate|version|edit|mix|acoustic|instrumental|karaoke|reprise)\b/i;

export function normalizeSignalTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|live|mono|stereo|demo|sessions?|roughs?|outtakes?|version|edit|mix).*$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSignalTitle(value: string): string[] {
  return value
    .split(/\s*\/\s*/)
    .map((part) => normalizeSignalTitle(part))
    .filter(Boolean);
}

function signalScore(input: TrackSignalInput): number {
  const peak = input.peakChartPosition && input.peakChartPosition > 0 ? Math.min(100, input.peakChartPosition) : 100;
  const weeks = Math.max(0, input.chartWeeks ?? 0);
  const variantPenalty = VARIANT_PATTERN.test(input.title) ? 160 : 0;
  const pairedPenalty = splitSignalTitle(input.title).length > 1 ? 45 : 0;
  return (101 - peak) * 10 + Math.log1p(weeks) * 38 - variantPenalty - pairedPenalty;
}

export function curateTrackSignals<T extends TrackSignalInput>(tracks: T[]): Array<CuratedTrackSignal<T>> {
  const standaloneKeys = new Set(
    tracks
      .filter((track) => !track.title.includes("/"))
      .map((track) => normalizeSignalTitle(track.title))
      .filter(Boolean),
  );
  const bestByKey = new Map<string, { score: number; index: number }>();
  const prepared = tracks.map((track, index) => {
    const parts = splitSignalTitle(track.title);
    const normalized = normalizeSignalTitle(track.title);
    const pairedWithStandalone = parts.length > 1 && parts.some((part) => standaloneKeys.has(part));
    const key = pairedWithStandalone ? parts.find((part) => standaloneKeys.has(part)) ?? normalized : normalized;
    const score = signalScore(track);
    const bestScore = pairedWithStandalone ? score - 1000 : score;
    const current = bestByKey.get(key);
    if (!current || bestScore > current.score) bestByKey.set(key, { score: bestScore, index });
    return { track, index, key, score, pairedWithStandalone, variant: VARIANT_PATTERN.test(track.title) };
  });

  return prepared
    .map(({ track, index, key, score, pairedWithStandalone, variant }) => {
      const best = bestByKey.get(key);
      const duplicate = best ? best.index !== index : false;
      const signalTier: SignalTier = variant ? "archive" : pairedWithStandalone || duplicate ? "related" : "primary";
      const signalReason =
        signalTier === "primary"
          ? "canonical chart signal"
          : signalTier === "related"
          ? "related chart alias"
          : "archive variant";
      return {
        ...track,
        signalTier,
        signalScore: score,
        signalKey: key,
        signalReason,
      };
    })
    .sort((a, b) => {
      const tierOrder = { primary: 0, related: 1, archive: 2 };
      const tierDelta = tierOrder[a.signalTier] - tierOrder[b.signalTier];
      if (tierDelta !== 0) return tierDelta;
      if (b.signalScore !== a.signalScore) return b.signalScore - a.signalScore;
      return a.title.localeCompare(b.title);
    });
}
