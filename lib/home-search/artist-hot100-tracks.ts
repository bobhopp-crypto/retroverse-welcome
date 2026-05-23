import { HOT100_SOURCE_SYSTEM } from "@/lib/track-deck/constants";
import { getHot100Db } from "@/lib/track-deck/db";

export type ArtistHot100TrackRow = {
  id: string;
  title: string;
  artist: string;
  releaseYear: number | null;
  peakChartPosition: number;
  chartWeeks: number;
  firstChartDate: string | null;
};

function normalizeHot100Name(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Local Hot 100 peaks for artist-first search expansion. */
export function loadArtistHot100TracksForSearch(artistName: string, limit = 16): ArtistHot100TrackRow[] {
  try {
    const db = getHot100Db();
    const artistExact = artistName.trim().toLowerCase();
    const artistNorm = normalizeHot100Name(artistName);
    const rows = db.prepare(`
      SELECT
        w.work_id AS work_id,
        w.title_display AS title,
        p.name_display AS artist,
        MIN(ee.rank) AS peak,
        COUNT(*) AS week_count,
        MAX(COALESCE(ee.weeks_on_chart, 0)) AS max_weeks,
        MIN(e.issue_date) AS first_date
      FROM work w
      JOIN person p ON p.person_id = w.primary_person_id
      JOIN event_entry ee ON ee.work_id = w.work_id
      JOIN event e ON e.event_id = ee.event_id
      WHERE e.source_system = @source
        AND (
          lower(p.name_display) = @artistExact
          OR p.name_norm = @artistExact
          OR p.name_norm = @artistNorm
        )
      GROUP BY w.work_id
      ORDER BY peak ASC, max_weeks DESC, week_count DESC, w.title_display ASC
      LIMIT @limit
    `).all({ source: HOT100_SOURCE_SYSTEM, artistExact, artistNorm, limit }) as Array<{
      work_id: string;
      title: string;
      artist: string;
      peak: number;
      week_count: number;
      max_weeks: number | null;
      first_date: string | null;
    }>;
    return rows
      .filter((row) => Number.isFinite(row.peak))
      .map((row) => ({
        id: `hot100:${row.work_id}`,
        title: row.title.trim(),
        artist: row.artist.trim(),
        releaseYear: row.first_date ? Number.parseInt(row.first_date.slice(0, 4), 10) : null,
        peakChartPosition: row.peak,
        chartWeeks: Math.max(row.week_count, row.max_weeks ?? 0),
        firstChartDate: row.first_date,
      }));
  } catch {
    return [];
  }
}
