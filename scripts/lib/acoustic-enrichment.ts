import { createHash } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const ACOUSTIC_LOG_ROOT =
  process.env.ACOUSTIC_IMPORT_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/acoustic_import";
export const ACOUSTIC_DB_PATH =
  process.env.ACOUSTIC_SQLITE_PATH ??
  "/Users/bobhopp/RETROVERSE_DATA/databases/billboard-200-albums-charts.db";
export const ACOUSTIC_SOURCE_TABLE = process.env.ACOUSTIC_SOURCE_TABLE ?? "acoustic_features";
export const ENRICHMENT_SOURCE =
  process.env.ACOUSTIC_ENRICHMENT_SOURCE ?? "billboard_acoustic_sqlite";

export async function ensureAcousticLogDir(): Promise<string> {
  await mkdir(ACOUSTIC_LOG_ROOT, { recursive: true });
  return ACOUSTIC_LOG_ROOT;
}

export function tsSlug(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function normalizeKey(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['"’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function fingerprintRow(
  song: string | null | undefined,
  album: string | null | undefined,
  artist: string | null | undefined,
  albumIdentity: string | null | undefined,
): string {
  const raw = [
    normalizeKey(song),
    normalizeKey(album),
    normalizeKey(artist),
    (albumIdentity ?? "").trim().toLowerCase(),
  ].join("|");
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

export type SqliteColumnMap = {
  source_song: string | null;
  source_album: string | null;
  source_artist: string | null;
  source_album_identity: string | null;
  source_date: string | null;
  acousticness: string | null;
  danceability: string | null;
  energy: string | null;
  valence: string | null;
  tempo: string | null;
  loudness: string | null;
  speechiness: string | null;
  instrumentalness: string | null;
  duration_ms: string | null;
  time_signature: string | null;
};

const ALIASES: Record<keyof SqliteColumnMap, string[]> = {
  source_song: [
    "source_song",
    "song",
    "song_title",
    "track",
    "track_title",
    "title",
    "track_name",
    "name",
    "song_name",
    "tracktitle",
  ],
  source_album: ["source_album", "album", "album_title", "album_name", "collection", "album_title_text"],
  source_artist: [
    "source_artist",
    "artist",
    "artist_name",
    "performer",
    "primary_artist",
    "artist_primary",
    "album_artist",
  ],
  source_album_identity: [
    "source_album_identity",
    "album_identity",
    "billboard_album_id",
    "bb_album_id",
    "album_id",
    "spotify_album_id",
    "canonical_album_key",
  ],
  source_date: ["source_date", "feature_date", "snapshot_date", "acquired_at", "updated_at"],
  acousticness: ["acousticness"],
  danceability: ["danceability"],
  energy: ["energy"],
  valence: ["valence"],
  tempo: ["tempo"],
  loudness: ["loudness"],
  speechiness: ["speechiness"],
  instrumentalness: ["instrumentalness"],
  duration_ms: ["duration_ms", "duration"],
  time_signature: ["time_signature", "time_sig", "timesignature"],
};

export function buildColumnMap(actualColumns: Set<string>): SqliteColumnMap {
  const lower = new Map([...actualColumns].map((c) => [c.toLowerCase(), c]));
  const pick = (aliases: string[]): string | null => {
    for (const a of aliases) {
      const hit = lower.get(a.toLowerCase());
      if (hit) return hit;
    }
    return null;
  };
  const result = {} as SqliteColumnMap;
  for (const key of Object.keys(ALIASES) as (keyof SqliteColumnMap)[]) {
    result[key] = pick(ALIASES[key]);
  }
  return result;
}

export function parseNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parseIntMaybe(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = String(value).trim();
  if (!t) return null;
  const n = Number.parseInt(t, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseDateMaybe(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = String(value).trim();
  if (!t) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  return null;
}

export function getRowValue(row: Record<string, unknown>, col: string | null): string | null {
  if (!col) return null;
  const v = row[col];
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return String(v);
  return String(v);
}

export function logFileBase(prefix: string, ext: string): string {
  return path.join(ACOUSTIC_LOG_ROOT, `${prefix}_${tsSlug()}.${ext}`);
}

/** Most recently written log artifact matching `prefix_*.{ext}` under the acoustic log root. */
export async function latestAcousticLogPath(prefix: string, ext: string): Promise<string | null> {
  await ensureAcousticLogDir();
  const needle = `${prefix}_`;
  const suff = `.${ext}`;
  const names = (await readdir(ACOUSTIC_LOG_ROOT)).filter((f) => f.startsWith(needle) && f.endsWith(suff));
  if (names.length === 0) return null;
  const scored = await Promise.all(
    names.map(async (f) => {
      const full = path.join(ACOUSTIC_LOG_ROOT, f);
      const st = await stat(full);
      return { full, mtime: st.mtimeMs };
    }),
  );
  scored.sort((a, b) => b.mtime - a.mtime);
  return scored[0]!.full;
}
