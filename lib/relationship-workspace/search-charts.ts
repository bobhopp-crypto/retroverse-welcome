import { HOT100_SOURCE_SYSTEM } from "@/lib/track-deck/constants";
import { getHot100Db } from "@/lib/track-deck/db";

import { fuzzyScoreParts } from "./fuzzy";
import type { ChartPanelEntry } from "./types";

const CHART_SEARCH_SQL = `
  SELECT
    e.issue_date,
    ee.rank,
    ee.peak_pos,
    ee.weeks_on_chart,
    ee.last_week,
    w.work_id,
    w.title_display,
    COALESCE(p.name_display, '') AS artist
  FROM work w
  LEFT JOIN person p ON p.person_id = w.primary_person_id
  JOIN event_entry ee ON ee.work_id = w.work_id
  JOIN event e ON e.event_id = ee.event_id
  WHERE e.source_system = @source
    AND (
      lower(w.title_display) LIKE @titleLike
      OR lower(COALESCE(p.name_display, '')) LIKE @artistLike
    )
  ORDER BY e.issue_date DESC, ee.rank ASC
  LIMIT 120
`;

type SqlRow = {
  issue_date: string;
  rank: number;
  peak_pos: number | null;
  weeks_on_chart: number | null;
  last_week: number | null;
  work_id: string;
  title_display: string;
  artist: string;
};

function likeNeedle(s: string): string {
  const t = s.trim().toLowerCase().replace(/%/g, "");
  if (!t) return "%";
  const token = t.split(/\s+/).find((p) => p.length > 2) ?? t.split(/\s+/)[0] ?? t;
  return `%${token}%`;
}

export function searchChartEntries(input: {
  artist: string;
  title: string;
  limit?: number;
}): ChartPanelEntry[] {
  let db;
  try {
    db = getHot100Db();
  } catch {
    return [];
  }

  const rows = db.prepare(CHART_SEARCH_SQL).all({
    source: HOT100_SOURCE_SYSTEM,
    titleLike: likeNeedle(input.title),
    artistLike: likeNeedle(input.artist),
  }) as SqlRow[];

  const scored: ChartPanelEntry[] = [];
  for (const row of rows) {
    const title = row.title_display.trim();
    const artist = (row.artist ?? "").trim() || "—";
    const label = `${artist} ${title}`;
    const { score, reason } = fuzzyScoreParts(label, input.artist, input.title);
    if (score < 15) continue;
    scored.push({
      issueDate: row.issue_date,
      rank: row.rank,
      peakPos: row.peak_pos,
      weeksOnChart: row.weeks_on_chart,
      lastWeek: row.last_week,
      title,
      artist,
      workId: row.work_id,
      score,
      reason,
    });
  }

  scored.sort((a, b) => b.score - a.score || b.issueDate.localeCompare(a.issueDate));
  return scored.slice(0, input.limit ?? 24);
}
