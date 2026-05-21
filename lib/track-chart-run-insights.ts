import type { TrackTrajectoryWeek } from "@/lib/load-track-trajectory";

export type ChartRunInsights = {
  peakWeek: TrackTrajectoryWeek | null;
  peakWeekIndex: number;
  longestRunStart: number;
  longestRunEnd: number;
  longestRunWeeks: number;
};

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/** Peak week, longest contiguous chart run, and indices for callouts. */
export function computeChartRunInsights(weeks: TrackTrajectoryWeek[]): ChartRunInsights {
  if (!weeks.length) {
    return {
      peakWeek: null,
      peakWeekIndex: -1,
      longestRunStart: 0,
      longestRunEnd: 0,
      longestRunWeeks: 0,
    };
  }

  let peakWeekIndex = 0;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i]!.rank < weeks[peakWeekIndex]!.rank) peakWeekIndex = i;
  }

  let bestStart = 0;
  let bestLen = 1;
  let curStart = 0;
  let curLen = 1;
  for (let i = 1; i < weeks.length; i++) {
    if (daysBetween(weeks[i - 1]!.issueDate, weeks[i]!.issueDate) <= 10) {
      curLen += 1;
    } else {
      if (curLen > bestLen) {
        bestStart = curStart;
        bestLen = curLen;
      }
      curStart = i;
      curLen = 1;
    }
  }
  if (curLen > bestLen) {
    bestStart = curStart;
    bestLen = curLen;
  }

  return {
    peakWeek: weeks[peakWeekIndex] ?? null,
    peakWeekIndex,
    longestRunStart: bestStart,
    longestRunEnd: bestStart + bestLen - 1,
    longestRunWeeks: bestLen,
  };
}
