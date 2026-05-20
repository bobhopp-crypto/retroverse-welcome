import Database from "better-sqlite3";

import { billboard200SqlitePath } from "@/lib/viewer-corpus-sqlite";
import { tryCreateClient } from "@/lib/supabase";

export type AlbumChartRunWeek = {
  chart_date: string;
  chart_position: number;
};

let bb200Db: Database.Database | null = null;

function getBillboard200Db(): Database.Database | null {
  try {
    if (!bb200Db) {
      bb200Db = new Database(billboard200SqlitePath(), { readonly: true, fileMustExist: true });
    }
    return bb200Db;
  } catch {
    return null;
  }
}

function loadChartRunFromBillboardSqlite(artist: string, album: string): AlbumChartRunWeek[] {
  const db = getBillboard200Db();
  if (!db) return [];

  try {
    const rows = db
      .prepare(
        `SELECT date AS chart_date, CAST(rank AS INTEGER) AS chart_position
         FROM albums
         WHERE artist = ? AND album = ?
           AND rank GLOB '[0-9]*'
           AND CAST(rank AS INTEGER) BETWEEN 1 AND 200
         ORDER BY date ASC`,
      )
      .all(artist.trim(), album.trim()) as Array<{ chart_date: string; chart_position: number }>;

    return rows
      .map((row) => ({
        chart_date: String(row.chart_date ?? "").slice(0, 10),
        chart_position: Number(row.chart_position),
      }))
      .filter((row) => row.chart_date && Number.isFinite(row.chart_position) && row.chart_position >= 1);
  } catch {
    return [];
  }
}

/** Week-by-week Billboard 200 run — Supabase first, then local Billboard SQLite. */
export async function loadAlbumChartRunWeeks(
  albumId: string,
  identity?: { artist: string; album: string },
): Promise<AlbumChartRunWeek[]> {
  const supabase = tryCreateClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("canonical_album_chart_runs")
      .select("chart_date, chart_position")
      .eq("retroverse_album_id", albumId)
      .order("chart_date", { ascending: true });

    if (!error && data?.length) {
      const weeks = data
        .map((row) => ({
          chart_date: String(row.chart_date ?? "").slice(0, 10),
          chart_position: Number(row.chart_position),
        }))
        .filter((row) => row.chart_date && Number.isFinite(row.chart_position) && row.chart_position >= 1);
      if (weeks.length) return weeks;
    }
  }

  if (identity?.artist?.trim() && identity?.album?.trim()) {
    return loadChartRunFromBillboardSqlite(identity.artist, identity.album);
  }

  return [];
}
