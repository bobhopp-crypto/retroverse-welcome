import { HOT100_SOURCE_SYSTEM } from "@/lib/track-deck/constants";
import { getHot100Db } from "@/lib/track-deck/db";

import { sortByMatchScore } from "./rank";
import type { HomeSearchChart, HomeSearchTrack } from "./types";

const WORK_SQL = `
  SELECT
    w.work_id AS work_id,
    w.title_display AS title,
    COALESCE(p.name_display, '') AS artist
  FROM work w
  LEFT JOIN person p ON p.person_id = w.primary_person_id
  WHERE lower(w.title_display) LIKE @like
     OR lower(COALESCE(p.name_display, '')) LIKE @like
  GROUP BY w.work_id
  LIMIT 20
`;

const WEEKS_BY_YEAR_SQL = `
  SELECT issue_date
  FROM event
  WHERE source_system = @source
    AND substr(issue_date, 1, 4) = @year
  ORDER BY issue_date DESC
  LIMIT 6
`;

function likeNeedle(q: string): string {
  const t = q.trim().toLowerCase().replace(/[%_]/g, "");
  if (!t) return "%";
  return `%${t}%`;
}

function formatChartLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Chart corpus fallback when Supabase track entities miss. */
export function searchHot100Tracks(q: string, limit = 6): HomeSearchTrack[] {
  let db;
  try {
    db = getHot100Db();
  } catch {
    return [];
  }

  const rows = db.prepare(WORK_SQL).all({ like: likeNeedle(q) }) as Array<{
    work_id: string;
    title: string;
    artist: string;
  }>;

  const mapped = rows.map((row) => {
    const title = row.title?.trim() || "—";
    const artist = row.artist?.trim() || "—";
    return {
      kind: "track" as const,
      title,
      artist,
      href: `/tracks/hot100-${row.work_id}`,
      subtitle: null,
      relation: "HOT100" as const,
    };
  });

  return sortByMatchScore(mapped, q, (r) => `${r.title} ${r.artist}`, limit);
}

export function searchHot100ChartWeeks(q: string): HomeSearchChart[] {
  const yearMatch = q.match(/\b(19\d{2}|20\d{2})\b/);
  if (!yearMatch) return [];

  const year = Number.parseInt(yearMatch[1]!, 10);
  if (!Number.isFinite(year)) return [];

  let db;
  try {
    db = getHot100Db();
  } catch {
    return [];
  }

  const rows = db.prepare(WEEKS_BY_YEAR_SQL).all({
    source: HOT100_SOURCE_SYSTEM,
    year: String(year),
  }) as Array<{ issue_date: string }>;

  return rows.map((row) => ({
    kind: "chart" as const,
    label: `Hot 100 · ${formatChartLabel(row.issue_date)}`,
    year,
    weekDate: row.issue_date,
    href: `/track-deck?date=${encodeURIComponent(row.issue_date)}`,
    relation: "HOT100" as const,
  }));
}
