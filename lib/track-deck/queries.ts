import { HOT100_SOURCE_SYSTEM } from "./constants";
import { getHot100Db } from "./db";
import { resolveTrackDeckOwnership } from "./ownership";
import type { TrackDeckTrackRow, TrackDeckWeekIndex, TrackDeckWeekPayload } from "./types";

type WeekRow = { issue_date: string; chart_seq: number; event_id: string };

type TrackSqlRow = {
  entry_id: string;
  work_id: string;
  rank: number;
  last_week: number | null;
  peak_pos: number | null;
  weeks_on_chart: number | null;
  title_display: string;
  artist: string | null;
  link_count: number;
  max_confidence: number | null;
  primary_vdj_path: string | null;
};

const WEEK_TRACKS_SQL = `
  SELECT
    ee.entry_id,
    ee.work_id,
    ee.rank,
    ee.last_week,
    ee.peak_pos,
    ee.weeks_on_chart,
    w.title_display,
    COALESCE(p.name_display, '') AS artist,
    (
      SELECT COUNT(*)
      FROM work_asset_link l
      WHERE l.work_id = w.work_id
    ) AS link_count,
    (
      SELECT MAX(l.confidence)
      FROM work_asset_link l
      WHERE l.work_id = w.work_id
    ) AS max_confidence,
    (
      SELECT a.file_path
      FROM work_asset_link l
      JOIN vdj_asset a ON a.asset_id = l.asset_id
      WHERE l.work_id = w.work_id
      ORDER BY l.confidence DESC, l.created_at DESC
      LIMIT 1
    ) AS primary_vdj_path
  FROM event e
  JOIN event_entry ee ON ee.event_id = e.event_id
  JOIN work w ON w.work_id = ee.work_id
  LEFT JOIN person p ON p.person_id = w.primary_person_id
  WHERE e.source_system = @source
    AND e.issue_date = @issueDate
  ORDER BY ee.rank ASC
`;

let weekIndexCache: TrackDeckWeekIndex | null = null;

export function loadTrackDeckWeekIndex(year?: number): TrackDeckWeekIndex {
  const db = getHot100Db();
  if (!year && weekIndexCache) return weekIndexCache;

  const bounds = db
    .prepare(
      `SELECT MIN(issue_date) AS min_date, MAX(issue_date) AS max_date, COUNT(*) AS week_count
       FROM event WHERE source_system = ?`,
    )
    .get(HOT100_SOURCE_SYSTEM) as {
    min_date: string;
    max_date: string;
    week_count: number;
  };

  const years = db
    .prepare(
      `SELECT CAST(substr(issue_date, 1, 4) AS INTEGER) AS year, COUNT(*) AS week_count
       FROM event
       WHERE source_system = ?
       GROUP BY year
       ORDER BY year ASC`,
    )
    .all(HOT100_SOURCE_SYSTEM) as Array<{ year: number; week_count: number }>;

  let weeksForYear: string[] = [];
  if (year != null && Number.isFinite(year)) {
    weeksForYear = (
      db
        .prepare(
          `SELECT issue_date FROM event
           WHERE source_system = ? AND substr(issue_date, 1, 4) = ?
           ORDER BY issue_date ASC`,
        )
        .all(HOT100_SOURCE_SYSTEM, String(year)) as Array<{ issue_date: string }>
    ).map((r) => r.issue_date);
  }

  const index: TrackDeckWeekIndex = {
    minDate: bounds.min_date,
    maxDate: bounds.max_date,
    weekCount: bounds.week_count,
    years: years.map((r) => ({ year: r.year, weekCount: r.week_count })),
    weeksForYear,
  };

  if (!year) weekIndexCache = index;
  return index;
}

export function resolveTrackDeckWeek(issueDate: string): WeekRow | null {
  const db = getHot100Db();
  const row = db
    .prepare(
      `SELECT issue_date, chart_seq, event_id
       FROM event
       WHERE source_system = ? AND issue_date = ?
       LIMIT 1`,
    )
    .get(HOT100_SOURCE_SYSTEM, issueDate) as WeekRow | undefined;
  return row ?? null;
}

export function nearestTrackDeckWeek(issueDate: string, direction: "prev" | "next"): string | null {
  const db = getHot100Db();
  if (direction === "prev") {
    const row = db
      .prepare(
        `SELECT issue_date FROM event
         WHERE source_system = ? AND issue_date < ?
         ORDER BY issue_date DESC LIMIT 1`,
      )
      .get(HOT100_SOURCE_SYSTEM, issueDate) as { issue_date: string } | undefined;
    return row?.issue_date ?? null;
  }
  const row = db
    .prepare(
      `SELECT issue_date FROM event
       WHERE source_system = ? AND issue_date > ?
       ORDER BY issue_date ASC LIMIT 1`,
    )
    .get(HOT100_SOURCE_SYSTEM, issueDate) as { issue_date: string } | undefined;
  return row?.issue_date ?? null;
}

function mapTrackRow(row: TrackSqlRow): TrackDeckTrackRow {
  const linkCount = Number(row.link_count) || 0;
  const maxConfidence =
    row.max_confidence == null ? null : Number(row.max_confidence);
  const vdjPath = row.primary_vdj_path?.trim() || null;
  const ownership = resolveTrackDeckOwnership({ linkCount, maxConfidence, vdjPath });
  return {
    entryId: row.entry_id,
    workId: row.work_id,
    rank: row.rank,
    lastWeek: row.last_week,
    peakPos: row.peak_pos,
    weeksOnChart: row.weeks_on_chart,
    title: row.title_display.trim(),
    artist: (row.artist ?? "").trim() || "—",
    ownership,
    vdjPath,
    linkCount,
    maxConfidence,
    playbackSource: "search",
    playableUrl: "",
  };
}

export function loadTrackDeckWeek(issueDate: string): TrackDeckWeekPayload | null {
  const week = resolveTrackDeckWeek(issueDate);
  if (!week) return null;

  const db = getHot100Db();
  const rows = db.prepare(WEEK_TRACKS_SQL).all({
    source: HOT100_SOURCE_SYSTEM,
    issueDate,
  }) as TrackSqlRow[];

  const tracks = rows.map(mapTrackRow);
  const stats = {
    total: tracks.length,
    owned: 0,
    missing: 0,
    partial: 0,
    linked: 0,
    unmatched: 0,
  };
  for (const t of tracks) {
    stats[t.ownership] += 1;
  }

  return {
    week: {
      issueDate: week.issue_date,
      chartSeq: week.chart_seq,
      eventId: week.event_id,
    },
    tracks,
    stats,
  };
}
