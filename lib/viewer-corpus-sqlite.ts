import Database from "better-sqlite3";
import path from "node:path";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { comparePortalYearAlbumRank } from "@/lib/portal-year-rank-sort";
import { getHot100Db } from "@/lib/track-deck/db";
import { HOT100_SOURCE_SYSTEM } from "@/lib/track-deck/constants";

import type { ViewerYearAlbumEntry } from "./viewer-scope";

export const DEFAULT_BILLBOARD200_SQLITE =
  "/Users/bobhopp/RETROVERSE_DATA/databases/billboard-200-albums-charts.db";

export function billboard200SqlitePath(): string {
  const raw = process.env.BILLBOARD200_SQLITE_PATH?.trim();
  if (!raw) return DEFAULT_BILLBOARD200_SQLITE;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

const SQLITE_ALBUM_PREFIX = "BB200-";

export function sqliteAlbumId(artist: string, album: string): string {
  const payload = Buffer.from(
    JSON.stringify({ a: artist.trim(), t: album.trim() }),
    "utf8",
  ).toString("base64url");
  return `${SQLITE_ALBUM_PREFIX}${payload}`;
}

export function decodeSqliteAlbumId(id: string): { artist: string; album: string } | null {
  if (!id.startsWith(SQLITE_ALBUM_PREFIX)) return null;
  try {
    const raw = Buffer.from(id.slice(SQLITE_ALBUM_PREFIX.length), "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as { a?: string; t?: string };
    const artist = typeof parsed.a === "string" ? parsed.a.trim() : "";
    const album = typeof parsed.t === "string" ? parsed.t.trim() : "";
    if (!artist || !album) return null;
    return { artist, album };
  } catch {
    return null;
  }
}

export function isSqliteCorpusAlbumId(id: string): boolean {
  return id.startsWith(SQLITE_ALBUM_PREFIX);
}

let bb200Db: Database.Database | null = null;

function getBillboard200Db(): Database.Database {
  if (!bb200Db) {
    bb200Db = new Database(billboard200SqlitePath(), { readonly: true, fileMustExist: true });
  }
  return bb200Db;
}

export type SqliteCorpusCounts = {
  billboard200WeeklyRows: number;
  hot100Weeks: number;
};

export function loadSqliteCorpusCounts(): SqliteCorpusCounts {
  let billboard200WeeklyRows = 0;
  let hot100Weeks = 0;
  try {
    const row = getBillboard200Db()
      .prepare(`SELECT COUNT(*) AS c FROM albums WHERE rank GLOB '[0-9]*'`)
      .get() as { c: number };
    billboard200WeeklyRows = Number(row?.c) || 0;
  } catch {
    /* optional */
  }
  try {
    const row = getHot100Db()
      .prepare(`SELECT COUNT(*) AS c FROM event WHERE source_system = ?`)
      .get(HOT100_SOURCE_SYSTEM) as { c: number };
    hot100Weeks = Number(row?.c) || 0;
  } catch {
    /* optional */
  }
  return { billboard200WeeklyRows, hot100Weeks };
}

/** Distinct chart years from Billboard 200 SQLite + Hot 100 weeks. */
export function loadSqliteCorpusYears(): number[] {
  const years = new Set<number>();

  try {
    const rows = getBillboard200Db()
      .prepare(
        `SELECT DISTINCT CAST(substr(date, 1, 4) AS INTEGER) AS y
         FROM albums
         WHERE date IS NOT NULL AND length(date) >= 4 AND rank GLOB '[0-9]*'`,
      )
      .all() as Array<{ y: number | null }>;
    for (const r of rows) {
      if (typeof r.y === "number" && Number.isFinite(r.y) && r.y >= 1800 && r.y <= 2100) {
        years.add(r.y);
      }
    }
  } catch (e) {
    console.warn(
      `[portal/bootstrap] years_sqlite_bb200 error=${e instanceof Error ? e.message : String(e)}`,
    );
  }

  try {
    const rows = getHot100Db()
      .prepare(
        `SELECT DISTINCT CAST(substr(issue_date, 1, 4) AS INTEGER) AS y
         FROM event WHERE source_system = ?`,
      )
      .all(HOT100_SOURCE_SYSTEM) as Array<{ y: number | null }>;
    for (const r of rows) {
      if (typeof r.y === "number" && Number.isFinite(r.y) && r.y >= 1800 && r.y <= 2100) {
        years.add(r.y);
      }
    }
  } catch (e) {
    console.warn(
      `[portal/bootstrap] years_sqlite_hot100 error=${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return [...years].sort((a, b) => b - a);
}

type Bb200AggRow = {
  artist: string;
  album: string;
  min_pos: number;
  row_count: number;
  first_date: string;
};

/** Billboard 200 weekly SQLite → portal year album list (BB200-prefixed ids). */
export function loadSqliteRankedAlbumEntriesForYear(year: number): ViewerYearAlbumEntry[] {
  const db = getBillboard200Db();
  const fromDate = `${year}-01-01`;
  const toDate = `${year}-12-31`;

  const rows = db
    .prepare(
      `SELECT
         artist,
         album,
         MIN(CAST(rank AS INTEGER)) AS min_pos,
         COUNT(*) AS row_count,
         MIN(date) AS first_date
       FROM albums
       WHERE date >= ? AND date <= ?
         AND rank GLOB '[0-9]*'
         AND CAST(rank AS INTEGER) > 0
         AND artist IS NOT NULL AND trim(artist) != ''
         AND album IS NOT NULL AND trim(album) != ''
       GROUP BY artist, album`,
    )
    .all(fromDate, toDate) as Bb200AggRow[];

  const sortKeys = rows.map((r) => {
    const artist = String(r.artist ?? "").trim();
    const album = String(r.album ?? "").trim();
    return {
      peakChartPosition: Number(r.min_pos) || 999,
      weeksOnChart: 0,
      weeklyChartRows: Number(r.row_count) || 0,
      firstChartDate: String(r.first_date ?? `${year}-01-01`),
      artist,
      album,
      albumId: sqliteAlbumId(artist, album),
    };
  });

  sortKeys.sort(comparePortalYearAlbumRank);

  return sortKeys.map((r, i) => ({
    albumId: r.albumId,
    displayRank: i + 1,
    peakChartPosition: r.peakChartPosition < 999 ? r.peakChartPosition : null,
    weeksOnChart: null,
  }));
}

export function hydrateSqliteAlbumRows(
  albumIds: string[],
  year: number | null,
): DiscoverStableAlbumRow[] {
  const out: DiscoverStableAlbumRow[] = [];
  for (const raw of albumIds) {
    const id = raw.trim();
    const decoded = decodeSqliteAlbumId(id);
    if (!decoded) continue;
    out.push({
      kind: "album",
      albumId: id,
      title: decoded.album,
      artist: decoded.artist,
      year,
      canonicalCoverPath: null,
      trustState: "provisional",
    });
  }
  return out;
}
