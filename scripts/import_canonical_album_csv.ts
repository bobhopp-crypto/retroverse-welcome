import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

const IMPORT_SOURCE = "canonical_csv_import";
const IMPORT_ROOT = process.env.RETROVERSE_IMPORT_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/imports/canonical";
const IMPORT_LOG_ROOT = process.env.RETROVERSE_IMPORT_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/imports";

type EntityType = "artist" | "album" | "track" | "chart";
type AlbumType = "studio" | "soundtrack" | "compilation" | "live" | "ep" | "single" | "other";
type ProvenanceLevel = "verified" | "canonicalized" | "inferred" | "editorial" | "placeholder";

type CsvRow = Record<string, string>;

type AlbumCsv = {
  rowNumber: number;
  sourceKey: string;
  title: string;
  albumArtistName: string;
  releaseYear: number | null;
  albumType: AlbumType;
  soundtrackFlag: boolean;
  eraSlug: string | null;
  releaseDate: string | null;
  notes: string | null;
  sourceTitle: string | null;
  sourceArtist: string | null;
  editionKey: string;
  editionName: string;
  editionReleaseDate: string | null;
  editionReleaseYear: number | null;
  provenanceLevel: ProvenanceLevel;
};

type TrackCsv = {
  rowNumber: number;
  sourceKey: string;
  albumSourceKey: string | null;
  albumTitle: string | null;
  albumArtistName: string | null;
  title: string;
  artistName: string;
  releaseYear: number | null;
  discNumber: number;
  trackNumber: number;
  sideCode: string | null;
  sidePosition: number | null;
  soundtrackExclusive: boolean;
  isInterlude: boolean;
  notes: string | null;
  sourceTitle: string | null;
  sourceArtist: string | null;
  provenanceLevel: ProvenanceLevel;
};

type ChartCsv = {
  rowNumber: number;
  sourceKey: string;
  trackSourceKey: string | null;
  trackTitle: string | null;
  trackArtistName: string | null;
  albumSourceKey: string | null;
  chartDate: string;
  chartName: string;
  chartPosition: number;
  weeksOnChart: number | null;
  provenanceLevel: ProvenanceLevel;
};

type ExistingArtist = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type ExistingAlbum = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  soundtrack_flag: boolean;
  album_type: AlbumType | null;
  era_id: string | null;
};

type ExistingTrack = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  retroverse_album_id: string | null;
  release_year: number | null;
  era_id: string | null;
};

type ExistingEdition = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
  edition_key: string;
  release_year: number | null;
  is_primary: boolean;
};

type ExistingAlbumTrack = {
  retroverse_album_track_id: string;
  retroverse_album_edition_id: string;
  disc_number: number;
  track_number: number;
};

type ExistingAlbumRole = {
  retroverse_album_artist_role_id: string;
  retroverse_album_id: string;
  retroverse_artist_id: string;
  relationship_role: string;
};

type ExistingChart = {
  retroverse_chart_id: string;
  retroverse_track_id: string;
  chart_name: string;
  chart_date: string;
  chart_position: number;
};

type ExistingEra = {
  retroverse_era_id: string;
  slug: string;
};

type ExistingSourceMatch = {
  retroverse_source_match_id: string;
  source: string;
  source_key: string;
  retroverse_entity_type: EntityType | "era";
  retroverse_entity_id: string;
};

type Report = {
  runId: string;
  startedAt: string;
  finishedAt: string;
  input: {
    albumsCsvPath: string;
    tracksCsvPath: string;
    chartCsvPath: string;
    albumsRows: number;
    tracksRows: number;
    chartRows: number;
  };
  counts: {
    imported: Record<string, number>;
    reused: Record<string, number>;
    failedRows: number;
  };
  duplicateWarnings: string[];
  mergeReport: string[];
  unresolvedAmbiguity: string[];
  failedRows: Array<{ dataset: "albums" | "tracks" | "chart_appearances"; rowNumber: number; reason: string }>;
};

type DeterministicAllocator = {
  allocate: (canonicalKey: string) => string;
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSlug(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function parseBoolean(value: string | undefined, fallback = false): boolean {
  if (!value) return fallback;
  const normalized = normalizeText(value);
  if (["1", "true", "yes", "y"].includes(normalized)) return true;
  if (["0", "false", "no", "n"].includes(normalized)) return false;
  return fallback;
}

function parseInteger(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashToSixDigits(input: string): number {
  const digest = createHash("sha1").update(input).digest("hex");
  const first = Number.parseInt(digest.slice(0, 12), 16);
  return first % 1_000_000;
}

function createAllocator(prefix: string, usedIds: Set<string>, existingByCanonicalKey: Map<string, string>): DeterministicAllocator {
  const allocatedByCanonicalKey = new Map<string, string>(existingByCanonicalKey);

  return {
    allocate(canonicalKey: string): string {
      const existing = allocatedByCanonicalKey.get(canonicalKey);
      if (existing) return existing;

      let probe = hashToSixDigits(`${prefix}:${canonicalKey}`);
      for (let attempt = 0; attempt < 1_000_000; attempt += 1) {
        const candidate = `${prefix}${String(probe).padStart(6, "0")}`;
        if (!usedIds.has(candidate)) {
          usedIds.add(candidate);
          allocatedByCanonicalKey.set(canonicalKey, candidate);
          return candidate;
        }
        probe = (probe + 1) % 1_000_000;
      }
      throw new Error(`Unable to allocate deterministic ID for ${prefix}:${canonicalKey}`);
    },
  };
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current);
  return values.map((value) => value.trim());
}

async function parseCsvFile(filePath: string): Promise<CsvRow[]> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((h) => normalizeSlug(h));

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const row: CsvRow = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

function pick(row: CsvRow, keys: string[]): string {
  for (const key of keys) {
    const normalizedKey = normalizeSlug(key);
    const value = row[normalizedKey];
    if (value !== undefined && value.trim().length > 0) return value.trim();
  }
  return "";
}

function parseAlbumCsv(rows: CsvRow[]): AlbumCsv[] {
  return rows.map((row, idx) => {
    const title = pick(row, ["canonical_album_title", "album_title", "title"]);
    const albumArtistName = pick(row, ["canonical_album_artist", "album_artist", "artist_name", "artist"]);
    const releaseYear = parseInteger(pick(row, ["release_year", "year"]));
    const albumTypeRaw = pick(row, ["album_type"]);
    const normalizedAlbumType = normalizeText(albumTypeRaw || "studio") as AlbumType;
    const soundtrackFlag = parseBoolean(pick(row, ["soundtrack_flag", "is_soundtrack"]), normalizedAlbumType === "soundtrack");
    const sourceKey =
      pick(row, ["source_key", "album_source_key"]) ||
      `${normalizeSlug(albumArtistName)}::${normalizeSlug(title)}::${releaseYear ?? "unknown"}`;

    return {
      rowNumber: idx + 2,
      sourceKey,
      title,
      albumArtistName,
      releaseYear,
      albumType: (["studio", "soundtrack", "compilation", "live", "ep", "single", "other"].includes(normalizedAlbumType)
        ? normalizedAlbumType
        : "other") as AlbumType,
      soundtrackFlag,
      eraSlug: pick(row, ["era_slug", "era"]) || null,
      releaseDate: pick(row, ["release_date"]) || null,
      notes: pick(row, ["notes"]) || null,
      sourceTitle: pick(row, ["source_title"]) || null,
      sourceArtist: pick(row, ["source_artist"]) || null,
      editionKey:
        pick(row, ["edition_key"]) ||
        `primary-${releaseYear ?? "unknown"}-${normalizeSlug(title).slice(0, 24)}`,
      editionName: pick(row, ["edition_name"]) || "Primary canonical edition",
      editionReleaseDate: pick(row, ["edition_release_date"]) || pick(row, ["release_date"]) || null,
      editionReleaseYear: parseInteger(pick(row, ["edition_release_year"])) ?? releaseYear,
      provenanceLevel: (pick(row, ["provenance_level"]) || "canonicalized") as ProvenanceLevel,
    };
  });
}

function parseTrackCsv(rows: CsvRow[]): TrackCsv[] {
  return rows.map((row, idx) => {
    const title = pick(row, ["canonical_title", "track_title", "title"]);
    const sourceKey =
      pick(row, ["source_key", "track_source_key"]) ||
      `${normalizeSlug(pick(row, ["artist_name", "canonical_artist_name", "track_artist"]))}::${normalizeSlug(title)}::${pick(
        row,
        ["album_source_key", "album_title"],
      )}`;

    return {
      rowNumber: idx + 2,
      sourceKey,
      albumSourceKey: pick(row, ["album_source_key"]) || null,
      albumTitle: pick(row, ["album_title", "canonical_album_title"]) || null,
      albumArtistName: pick(row, ["album_artist", "canonical_album_artist"]) || null,
      title,
      artistName:
        pick(row, ["canonical_artist_name", "artist_name", "track_artist"]) ||
        pick(row, ["album_artist", "canonical_album_artist"]),
      releaseYear: parseInteger(pick(row, ["release_year", "year"])),
      discNumber: parseInteger(pick(row, ["disc_number"])) ?? 1,
      trackNumber: parseInteger(pick(row, ["track_number"])) ?? 0,
      sideCode: pick(row, ["side_code"]) || null,
      sidePosition: parseInteger(pick(row, ["side_position"])),
      soundtrackExclusive: parseBoolean(pick(row, ["soundtrack_exclusive"]), false),
      isInterlude: parseBoolean(pick(row, ["is_interlude"]), false),
      notes: pick(row, ["notes"]) || null,
      sourceTitle: pick(row, ["source_title"]) || null,
      sourceArtist: pick(row, ["source_artist"]) || null,
      provenanceLevel: (pick(row, ["provenance_level"]) || "canonicalized") as ProvenanceLevel,
    };
  });
}

function parseChartCsv(rows: CsvRow[]): ChartCsv[] {
  return rows.map((row, idx) => {
    const sourceKey =
      pick(row, ["source_key", "chart_source_key"]) ||
      `${pick(row, ["track_source_key", "track_title"])}::${pick(row, ["chart_name"])}::${pick(row, ["chart_date"])}::${pick(
        row,
        ["chart_position"],
      )}`;

    return {
      rowNumber: idx + 2,
      sourceKey,
      trackSourceKey: pick(row, ["track_source_key"]) || null,
      trackTitle: pick(row, ["track_title", "canonical_title"]) || null,
      trackArtistName: pick(row, ["track_artist", "artist_name", "canonical_artist_name"]) || null,
      albumSourceKey: pick(row, ["album_source_key"]) || null,
      chartDate: pick(row, ["chart_date"]),
      chartName: pick(row, ["chart_name"]) || "Billboard Hot 100",
      chartPosition: parseInteger(pick(row, ["chart_position"])) ?? 0,
      weeksOnChart: parseInteger(pick(row, ["weeks_on_chart"])),
      provenanceLevel: (pick(row, ["provenance_level"]) || "verified") as ProvenanceLevel,
    };
  });
}

function requireString(value: string, message: string): string {
  if (!value || value.trim().length === 0) throw new Error(message);
  return value.trim();
}

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const payload = error as { code?: string; message?: string };
  if (payload.code === "42703") return true;
  if (payload.code === "PGRST204" && payload.message?.includes("provenance_level")) return true;
  return false;
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const payload = error as { code?: string; message?: string; details?: string; hint?: string };
    const parts = [payload.code, payload.message, payload.details, payload.hint].filter(Boolean);
    if (parts.length > 0) return parts.join(" | ");
  }
  return String(error);
}

function canonicalArtistKey(name: string): string {
  return normalizeText(name);
}

function canonicalAlbumKey(title: string, artistId: string): string {
  return `${normalizeText(title)}::${artistId}`;
}

function canonicalTrackKey(title: string, artistId: string): string {
  return `${normalizeText(title)}::${artistId}`;
}

function makeNowRunId(): string {
  const now = new Date();
  const iso = now.toISOString().replace(/[:.]/g, "-");
  return `canonical_import_${iso}`;
}

async function main() {
  const startedAt = new Date().toISOString();
  const runId = makeNowRunId();

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running import.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const albumsCsvPath = path.join(IMPORT_ROOT, "albums.csv");
  const tracksCsvPath = path.join(IMPORT_ROOT, "tracks.csv");
  const chartCsvPath = path.join(IMPORT_ROOT, "chart_appearances.csv");

  const [albumRowsRaw, trackRowsRaw, chartRowsRaw] = await Promise.all([
    parseCsvFile(albumsCsvPath),
    parseCsvFile(tracksCsvPath),
    parseCsvFile(chartCsvPath),
  ]);

  const albumsCsv = parseAlbumCsv(albumRowsRaw);
  const tracksCsv = parseTrackCsv(trackRowsRaw);
  const chartsCsv = parseChartCsv(chartRowsRaw);

  const report: Report = {
    runId,
    startedAt,
    finishedAt: startedAt,
    input: {
      albumsCsvPath,
      tracksCsvPath,
      chartCsvPath,
      albumsRows: albumsCsv.length,
      tracksRows: tracksCsv.length,
      chartRows: chartsCsv.length,
    },
    counts: {
      imported: {
        artists: 0,
        albums: 0,
        editions: 0,
        tracks: 0,
        album_tracks: 0,
        album_artist_roles: 0,
        chart_appearances: 0,
        source_matches: 0,
      },
      reused: {
        artists: 0,
        albums: 0,
        editions: 0,
        tracks: 0,
        album_tracks: 0,
        album_artist_roles: 0,
        chart_appearances: 0,
        source_matches: 0,
      },
      failedRows: 0,
    },
    duplicateWarnings: [],
    mergeReport: [],
    unresolvedAmbiguity: [],
    failedRows: [],
  };

  const [
    artistsResult,
    albumsResult,
    tracksResult,
    editionsResult,
    albumTracksResult,
    albumRolesResult,
    chartsResult,
    erasResult,
    sourceMatchesResult,
  ] = await Promise.all([
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, soundtrack_flag, album_type, era_id"),
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year, era_id"),
    supabase.from("retroverse_album_editions").select("retroverse_album_edition_id, retroverse_album_id, edition_key, release_year, is_primary"),
    supabase.from("retroverse_album_tracks").select("retroverse_album_track_id, retroverse_album_edition_id, disc_number, track_number"),
    supabase
      .from("retroverse_album_artist_roles")
      .select("retroverse_album_artist_role_id, retroverse_album_id, retroverse_artist_id, relationship_role"),
    supabase
      .from("retroverse_chart_appearances")
      .select("retroverse_chart_id, retroverse_track_id, chart_name, chart_date, chart_position"),
    supabase.from("retroverse_eras").select("retroverse_era_id, slug"),
    supabase
      .from("retroverse_source_matches")
      .select("retroverse_source_match_id, source, source_key, retroverse_entity_type, retroverse_entity_id")
      .eq("source", IMPORT_SOURCE),
  ]);

  for (const result of [
    artistsResult,
    albumsResult,
    tracksResult,
    editionsResult,
    albumTracksResult,
    albumRolesResult,
    chartsResult,
    erasResult,
    sourceMatchesResult,
  ]) {
    if (result.error) throw result.error;
  }

  const existingArtists = (artistsResult.data ?? []) as ExistingArtist[];
  const existingAlbums = (albumsResult.data ?? []) as ExistingAlbum[];
  const existingTracks = (tracksResult.data ?? []) as ExistingTrack[];
  const existingEditions = (editionsResult.data ?? []) as ExistingEdition[];
  const existingAlbumTracks = (albumTracksResult.data ?? []) as ExistingAlbumTrack[];
  const existingAlbumRoles = (albumRolesResult.data ?? []) as ExistingAlbumRole[];
  const existingCharts = (chartsResult.data ?? []) as ExistingChart[];
  const existingEras = (erasResult.data ?? []) as ExistingEra[];
  const existingSourceMatches = (sourceMatchesResult.data ?? []) as ExistingSourceMatch[];

  const usedArtistIds = new Set(existingArtists.map((row) => row.retroverse_artist_id));
  const usedAlbumIds = new Set(existingAlbums.map((row) => row.retroverse_album_id));
  const usedTrackIds = new Set(existingTracks.map((row) => row.retroverse_track_id));
  const usedEditionIds = new Set(existingEditions.map((row) => row.retroverse_album_edition_id));
  const usedAlbumTrackIds = new Set(existingAlbumTracks.map((row) => row.retroverse_album_track_id));
  const usedRoleIds = new Set(existingAlbumRoles.map((row) => row.retroverse_album_artist_role_id));
  const usedChartIds = new Set(existingCharts.map((row) => row.retroverse_chart_id));
  const usedSourceMatchIds = new Set(existingSourceMatches.map((row) => row.retroverse_source_match_id));

  const artistByNameKey = new Map(existingArtists.map((row) => [canonicalArtistKey(row.canonical_artist_name), row]));
  const albumByCanonicalKey = new Map(
    existingAlbums.map((row) => [canonicalAlbumKey(row.canonical_album_title, row.retroverse_artist_id), row]),
  );
  const trackByCanonicalKey = new Map(
    existingTracks.map((row) => [canonicalTrackKey(row.canonical_title, row.retroverse_artist_id), row]),
  );
  const editionByKey = new Map(existingEditions.map((row) => [`${row.retroverse_album_id}::${normalizeText(row.edition_key)}`, row]));
  const albumTrackBySlot = new Map(
    existingAlbumTracks.map((row) => [`${row.retroverse_album_edition_id}::${row.disc_number}::${row.track_number}`, row]),
  );
  const albumRoleByKey = new Map(
    existingAlbumRoles.map(
      (row) => [`${row.retroverse_album_id}::${row.retroverse_artist_id}::${normalizeText(row.relationship_role)}`, row],
    ),
  );
  const chartByKey = new Map(
    existingCharts.map((row) => [
      `${row.retroverse_track_id}::${normalizeText(row.chart_name)}::${row.chart_date}::${row.chart_position}`,
      row,
    ]),
  );
  const eraBySlug = new Map(existingEras.map((row) => [normalizeSlug(row.slug), row.retroverse_era_id]));
  const sourceMatchByUniqueKey = new Map(
    existingSourceMatches.map((row) => [
      `${row.source}::${normalizeText(row.source_key)}::${normalizeText(row.retroverse_entity_type)}`,
      row.retroverse_entity_id,
    ]),
  );

  const sourceMappedArtistIdByKey = new Map<string, string>();
  const sourceMappedAlbumIdByKey = new Map<string, string>();
  const sourceMappedTrackIdByKey = new Map<string, string>();
  for (const row of existingSourceMatches) {
    if (row.retroverse_entity_type === "artist") sourceMappedArtistIdByKey.set(normalizeText(row.source_key), row.retroverse_entity_id);
    if (row.retroverse_entity_type === "album") sourceMappedAlbumIdByKey.set(normalizeText(row.source_key), row.retroverse_entity_id);
    if (row.retroverse_entity_type === "track") sourceMappedTrackIdByKey.set(normalizeText(row.source_key), row.retroverse_entity_id);
  }

  const artistAllocator = createAllocator("RVAR", usedArtistIds, new Map());
  const albumAllocator = createAllocator("RVAL", usedAlbumIds, new Map());
  const trackAllocator = createAllocator("RVTR", usedTrackIds, new Map());
  const editionAllocator = createAllocator("RVED", usedEditionIds, new Map());
  const albumTrackAllocator = createAllocator("RVAT", usedAlbumTrackIds, new Map());
  const roleAllocator = createAllocator("RVRL", usedRoleIds, new Map());
  const chartAllocator = createAllocator("RVCH", usedChartIds, new Map());
  const sourceMatchAllocator = createAllocator("RVSM", usedSourceMatchIds, new Map());

  const albumIdBySourceKey = new Map<string, string>();
  const albumArtistIdByAlbumId = new Map<string, string>();
  const trackIdBySourceKey = new Map<string, string>();

  const upsertSourceMatches: Array<Record<string, unknown>> = [];

  const albumsSorted = [...albumsCsv].sort((a, b) => normalizeText(a.sourceKey).localeCompare(normalizeText(b.sourceKey)));
  for (const row of albumsSorted) {
    try {
      const title = requireString(row.title, `albums.csv row ${row.rowNumber}: missing canonical album title`);
      const artistName = requireString(row.albumArtistName, `albums.csv row ${row.rowNumber}: missing album artist`);

      const artistSourceKey = normalizeText(`artist::${artistName}`);
      let artistId = sourceMappedArtistIdByKey.get(artistSourceKey);
      let artist = artistId ? existingArtists.find((r) => r.retroverse_artist_id === artistId) ?? null : null;
      if (!artist) {
        artist = artistByNameKey.get(canonicalArtistKey(artistName)) ?? null;
      }
      if (!artist) {
        artistId = artistAllocator.allocate(`artist::${canonicalArtistKey(artistName)}`);
        const insertArtist = {
          retroverse_artist_id: artistId,
          canonical_artist_name: artistName,
          sort_name: artistName,
          notes: null,
        };
        const insertArtistResult = await supabase.from("retroverse_artists").upsert(insertArtist, { onConflict: "retroverse_artist_id" });
        if (insertArtistResult.error) throw insertArtistResult.error;
        artist = insertArtist;
        artistByNameKey.set(canonicalArtistKey(artistName), artist as ExistingArtist);
        report.counts.imported.artists += 1;
      } else {
        artistId = artist.retroverse_artist_id;
        report.counts.reused.artists += 1;
      }

      const albumSourceKey = normalizeText(row.sourceKey);
      const albumCanonicalKey = canonicalAlbumKey(title, artistId);
      let albumId = sourceMappedAlbumIdByKey.get(albumSourceKey);
      let album = albumId ? existingAlbums.find((r) => r.retroverse_album_id === albumId) ?? null : null;
      if (!album) album = albumByCanonicalKey.get(albumCanonicalKey) ?? null;
      if (!album) {
        albumId = albumAllocator.allocate(`album::${albumCanonicalKey}`);
        const upsertAlbum = {
          retroverse_album_id: albumId,
          canonical_album_title: title,
          retroverse_artist_id: artistId,
          release_year: row.releaseYear,
          soundtrack_flag: row.soundtrackFlag,
          era_id: row.eraSlug ? eraBySlug.get(normalizeSlug(row.eraSlug)) ?? null : null,
          release_date: row.releaseDate,
          album_type: row.albumType,
          provenance_level: row.provenanceLevel,
          notes: row.notes,
        };
        const upsertAlbumResult = await supabase.from("retroverse_albums").upsert(upsertAlbum, { onConflict: "retroverse_album_id" });
        if (upsertAlbumResult.error) {
          if (isMissingColumnError(upsertAlbumResult.error)) {
            const fallbackAlbumRow = { ...upsertAlbum };
            delete (fallbackAlbumRow as { provenance_level?: ProvenanceLevel }).provenance_level;
            const fallbackResult = await supabase
              .from("retroverse_albums")
              .upsert(fallbackAlbumRow, { onConflict: "retroverse_album_id" });
            if (fallbackResult.error) throw fallbackResult.error;
          } else {
            throw upsertAlbumResult.error;
          }
        }
        album = upsertAlbum as ExistingAlbum;
        albumByCanonicalKey.set(albumCanonicalKey, album);
        report.counts.imported.albums += 1;
      } else {
        albumId = album.retroverse_album_id;
        report.counts.reused.albums += 1;
      }

      albumIdBySourceKey.set(albumSourceKey, albumId);
      albumArtistIdByAlbumId.set(albumId, artistId);

      const editionKeyNormalized = normalizeText(row.editionKey);
      const existingEdition = editionByKey.get(`${albumId}::${editionKeyNormalized}`) ?? null;
      if (!existingEdition) {
        const albumHasPrimaryEdition = [...editionByKey.values()].some(
          (edition) => edition.retroverse_album_id === albumId && edition.is_primary,
        );
        const editionId = editionAllocator.allocate(`edition::${albumId}::${editionKeyNormalized}`);
        const upsertEdition = {
          retroverse_album_edition_id: editionId,
          retroverse_album_id: albumId,
          edition_key: row.editionKey,
          edition_name: row.editionName,
          release_date: row.editionReleaseDate,
          release_year: row.editionReleaseYear,
          era_id: row.eraSlug ? eraBySlug.get(normalizeSlug(row.eraSlug)) ?? null : null,
          is_primary: !albumHasPrimaryEdition,
          notes: albumHasPrimaryEdition
            ? "Imported as non-primary edition because a primary edition already exists."
            : "Imported from canonical CSV pipeline.",
        };
        const upsertEditionResult = await supabase
          .from("retroverse_album_editions")
          .upsert(upsertEdition, { onConflict: "retroverse_album_id,edition_key" });
        if (upsertEditionResult.error) throw upsertEditionResult.error;
        editionByKey.set(`${albumId}::${editionKeyNormalized}`, upsertEdition as ExistingEdition);
        report.counts.imported.editions += 1;
      } else {
        report.counts.reused.editions += 1;
      }

      const primaryRoleKey = `${albumId}::${artistId}::primary`;
      if (!albumRoleByKey.has(primaryRoleKey)) {
        const roleId = roleAllocator.allocate(`role::${primaryRoleKey}`);
        const roleRow = {
          retroverse_album_artist_role_id: roleId,
          retroverse_album_id: albumId,
          retroverse_artist_id: artistId,
          relationship_role: "primary",
          billing_order: 1,
          notes: "Canonical import pipeline primary album artist.",
        };
        const roleResult = await supabase
          .from("retroverse_album_artist_roles")
          .upsert(roleRow, { onConflict: "retroverse_album_id,retroverse_artist_id,relationship_role" });
        if (roleResult.error) throw roleResult.error;
        albumRoleByKey.set(primaryRoleKey, roleRow as ExistingAlbumRole);
        report.counts.imported.album_artist_roles += 1;
      } else {
        report.counts.reused.album_artist_roles += 1;
      }

      const artistSourceMatchKey = `${IMPORT_SOURCE}::${artistSourceKey}::artist`;
      if (!sourceMatchByUniqueKey.has(artistSourceMatchKey)) {
        const sourceMatchId = sourceMatchAllocator.allocate(`source::artist::${artistSourceKey}`);
        upsertSourceMatches.push({
          retroverse_source_match_id: sourceMatchId,
          source: IMPORT_SOURCE,
          source_key: artistSourceKey,
          source_title: row.sourceTitle ?? artistName,
          source_artist: row.sourceArtist ?? artistName,
          retroverse_entity_type: "artist",
          retroverse_entity_id: artistId,
          confidence_score: 1,
          manual_override: false,
          verified_by: `import:${runId}`,
          notes: "Deterministic canonical CSV import mapping.",
        });
        sourceMatchByUniqueKey.set(artistSourceMatchKey, artistId);
      }

      const albumSourceMatchKey = `${IMPORT_SOURCE}::${albumSourceKey}::album`;
      if (!sourceMatchByUniqueKey.has(albumSourceMatchKey)) {
        const sourceMatchId = sourceMatchAllocator.allocate(`source::album::${albumSourceKey}`);
        upsertSourceMatches.push({
          retroverse_source_match_id: sourceMatchId,
          source: IMPORT_SOURCE,
          source_key: albumSourceKey,
          source_title: row.sourceTitle ?? title,
          source_artist: row.sourceArtist ?? artistName,
          retroverse_entity_type: "album",
          retroverse_entity_id: albumId,
          confidence_score: 1,
          manual_override: false,
          verified_by: `import:${runId}`,
          notes: "Deterministic canonical CSV import mapping.",
        });
        sourceMatchByUniqueKey.set(albumSourceMatchKey, albumId);
      }
    } catch (error) {
      const message = formatError(error);
      report.failedRows.push({ dataset: "albums", rowNumber: row.rowNumber, reason: message });
    }
  }

  const tracksSorted = [...tracksCsv].sort((a, b) => normalizeText(a.sourceKey).localeCompare(normalizeText(b.sourceKey)));
  for (const row of tracksSorted) {
    try {
      const title = requireString(row.title, `tracks.csv row ${row.rowNumber}: missing track title`);
      const artistName = requireString(row.artistName, `tracks.csv row ${row.rowNumber}: missing track artist`);
      if (row.trackNumber <= 0) throw new Error(`tracks.csv row ${row.rowNumber}: track_number must be positive`);

      let targetAlbumId: string | null = null;
      if (row.albumSourceKey) {
        targetAlbumId = albumIdBySourceKey.get(normalizeText(row.albumSourceKey)) ?? sourceMappedAlbumIdByKey.get(normalizeText(row.albumSourceKey)) ?? null;
      }
      if (!targetAlbumId && row.albumTitle && row.albumArtistName) {
        const albumArtistNameKey = canonicalArtistKey(row.albumArtistName);
        const albumArtist = artistByNameKey.get(albumArtistNameKey);
        if (albumArtist) {
          const albumKey = canonicalAlbumKey(row.albumTitle, albumArtist.retroverse_artist_id);
          targetAlbumId = albumByCanonicalKey.get(albumKey)?.retroverse_album_id ?? null;
        }
      }
      if (!targetAlbumId) {
        report.unresolvedAmbiguity.push(`tracks.csv row ${row.rowNumber}: unable to resolve album for track "${title}"`);
        continue;
      }

      let trackArtist = artistByNameKey.get(canonicalArtistKey(artistName)) ?? null;
      if (!trackArtist) {
        const newArtistId = artistAllocator.allocate(`artist::${canonicalArtistKey(artistName)}`);
        const artistInsert = {
          retroverse_artist_id: newArtistId,
          canonical_artist_name: artistName,
          sort_name: artistName,
          notes: "Created during canonical track import.",
        };
        const artistInsertResult = await supabase.from("retroverse_artists").upsert(artistInsert, { onConflict: "retroverse_artist_id" });
        if (artistInsertResult.error) throw artistInsertResult.error;
        trackArtist = artistInsert as ExistingArtist;
        artistByNameKey.set(canonicalArtistKey(artistName), trackArtist);
        report.counts.imported.artists += 1;
      } else {
        report.counts.reused.artists += 1;
      }

      const trackSourceKey = normalizeText(row.sourceKey);
      let trackId = sourceMappedTrackIdByKey.get(trackSourceKey) ?? null;
      let track = trackId ? existingTracks.find((r) => r.retroverse_track_id === trackId) ?? null : null;
      const canonicalTrackKeyValue = canonicalTrackKey(title, trackArtist.retroverse_artist_id);
      if (!track) track = trackByCanonicalKey.get(canonicalTrackKeyValue) ?? null;

      if (!track) {
        trackId = trackAllocator.allocate(`track::${canonicalTrackKeyValue}`);
        const album = existingAlbums.find((r) => r.retroverse_album_id === targetAlbumId) ?? null;
        const trackInsert = {
          retroverse_track_id: trackId,
          canonical_title: title,
          retroverse_artist_id: trackArtist.retroverse_artist_id,
          retroverse_album_id: targetAlbumId,
          release_year: row.releaseYear ?? album?.release_year ?? null,
          era_id: album?.era_id ?? null,
          provenance_level: row.provenanceLevel,
          notes: row.notes,
        };
        const trackInsertResult = await supabase.from("retroverse_tracks").upsert(trackInsert, { onConflict: "retroverse_track_id" });
        if (trackInsertResult.error) {
          if (isMissingColumnError(trackInsertResult.error)) {
            const fallbackTrackRow = { ...trackInsert };
            delete (fallbackTrackRow as { provenance_level?: ProvenanceLevel }).provenance_level;
            const fallbackResult = await supabase
              .from("retroverse_tracks")
              .upsert(fallbackTrackRow, { onConflict: "retroverse_track_id" });
            if (fallbackResult.error) throw fallbackResult.error;
          } else {
            throw trackInsertResult.error;
          }
        }
        track = trackInsert as ExistingTrack;
        trackByCanonicalKey.set(canonicalTrackKeyValue, track);
        report.counts.imported.tracks += 1;
      } else {
        trackId = track.retroverse_track_id;
        report.counts.reused.tracks += 1;
      }

      trackIdBySourceKey.set(trackSourceKey, trackId);

      const editionCandidates = [...editionByKey.values()].filter((e) => e.retroverse_album_id === targetAlbumId && e.is_primary);
      const targetEdition = editionCandidates[0];
      if (!targetEdition) {
        report.unresolvedAmbiguity.push(
          `tracks.csv row ${row.rowNumber}: missing primary edition for album ${targetAlbumId} while importing "${title}"`,
        );
        continue;
      }

      const slotKey = `${targetEdition.retroverse_album_edition_id}::${row.discNumber}::${row.trackNumber}`;
      const existingMembership = albumTrackBySlot.get(slotKey) ?? null;
      if (!existingMembership) {
        const membershipId = albumTrackAllocator.allocate(`album_track::${slotKey}`);
        const membershipRow = {
          retroverse_album_track_id: membershipId,
          retroverse_album_edition_id: targetEdition.retroverse_album_edition_id,
          retroverse_track_id: trackId,
          disc_number: row.discNumber,
          track_number: row.trackNumber,
          side_code: row.sideCode,
          side_position: row.sidePosition,
          soundtrack_exclusive: row.soundtrackExclusive,
          is_interlude: row.isInterlude,
          notes: row.notes,
        };
        const membershipResult = await supabase
          .from("retroverse_album_tracks")
          .upsert(membershipRow, { onConflict: "retroverse_album_edition_id,disc_number,track_number" });
        if (membershipResult.error) throw membershipResult.error;
        albumTrackBySlot.set(slotKey, membershipRow as ExistingAlbumTrack);
        report.counts.imported.album_tracks += 1;
      } else {
        report.counts.reused.album_tracks += 1;
        if (existingMembership.retroverse_album_track_id !== slotKey) {
          report.mergeReport.push(
            `tracks.csv row ${row.rowNumber}: reused existing membership slot for ${title} at ${slotKey}`,
          );
        }
      }

      const album = existingAlbums.find((r) => r.retroverse_album_id === targetAlbumId) ?? null;
      if (album?.soundtrack_flag && trackArtist.retroverse_artist_id !== albumArtistIdByAlbumId.get(targetAlbumId)) {
        const roleKey = `${targetAlbumId}::${trackArtist.retroverse_artist_id}::soundtrack_primary`;
        if (!albumRoleByKey.has(roleKey)) {
          const roleId = roleAllocator.allocate(`role::${roleKey}`);
          const roleRow = {
            retroverse_album_artist_role_id: roleId,
            retroverse_album_id: targetAlbumId,
            retroverse_artist_id: trackArtist.retroverse_artist_id,
            relationship_role: "soundtrack_primary",
            billing_order: 2,
            notes: "Inferred from soundtrack track membership during import.",
          };
          const roleResult = await supabase
            .from("retroverse_album_artist_roles")
            .upsert(roleRow, { onConflict: "retroverse_album_id,retroverse_artist_id,relationship_role" });
          if (roleResult.error) throw roleResult.error;
          albumRoleByKey.set(roleKey, roleRow as ExistingAlbumRole);
          report.counts.imported.album_artist_roles += 1;
        } else {
          report.counts.reused.album_artist_roles += 1;
        }
      }

      const trackSourceMatchKey = `${IMPORT_SOURCE}::${trackSourceKey}::track`;
      if (!sourceMatchByUniqueKey.has(trackSourceMatchKey)) {
        const sourceMatchId = sourceMatchAllocator.allocate(`source::track::${trackSourceKey}`);
        upsertSourceMatches.push({
          retroverse_source_match_id: sourceMatchId,
          source: IMPORT_SOURCE,
          source_key: trackSourceKey,
          source_title: row.sourceTitle ?? title,
          source_artist: row.sourceArtist ?? artistName,
          retroverse_entity_type: "track",
          retroverse_entity_id: trackId,
          confidence_score: 1,
          manual_override: false,
          verified_by: `import:${runId}`,
          notes: "Deterministic canonical CSV import mapping.",
        });
        sourceMatchByUniqueKey.set(trackSourceMatchKey, trackId);
      }
    } catch (error) {
      const message = formatError(error);
      report.failedRows.push({ dataset: "tracks", rowNumber: row.rowNumber, reason: message });
    }
  }

  const chartsSorted = [...chartsCsv].sort((a, b) => normalizeText(a.sourceKey).localeCompare(normalizeText(b.sourceKey)));
  for (const row of chartsSorted) {
    try {
      const chartDate = requireString(row.chartDate, `chart_appearances.csv row ${row.rowNumber}: missing chart_date`);
      if (row.chartPosition <= 0) throw new Error(`chart_appearances.csv row ${row.rowNumber}: chart_position must be positive`);

      let targetTrackId: string | null = null;
      if (row.trackSourceKey) {
        const key = normalizeText(row.trackSourceKey);
        targetTrackId = trackIdBySourceKey.get(key) ?? sourceMappedTrackIdByKey.get(key) ?? null;
      }
      if (!targetTrackId && row.trackTitle && row.trackArtistName) {
        const trackArtist = artistByNameKey.get(canonicalArtistKey(row.trackArtistName)) ?? null;
        if (trackArtist) {
          const trackKey = canonicalTrackKey(row.trackTitle, trackArtist.retroverse_artist_id);
          targetTrackId = trackByCanonicalKey.get(trackKey)?.retroverse_track_id ?? null;
        }
      }
      if (!targetTrackId) {
        report.unresolvedAmbiguity.push(
          `chart_appearances.csv row ${row.rowNumber}: unable to resolve track for chart source key "${row.trackSourceKey ?? "n/a"}"`,
        );
        continue;
      }

      const chartKey = `${targetTrackId}::${normalizeText(row.chartName)}::${chartDate}::${row.chartPosition}`;
      const existingChart = chartByKey.get(chartKey) ?? null;
      let chartId: string;
      if (!existingChart) {
        chartId = chartAllocator.allocate(`chart::${chartKey}`);
        const chartRow = {
          retroverse_chart_id: chartId,
          retroverse_track_id: targetTrackId,
          chart_date: chartDate,
          chart_name: row.chartName,
          chart_position: row.chartPosition,
          weeks_on_chart: row.weeksOnChart,
          provenance_level: row.provenanceLevel,
        };
        const chartResult = await supabase.from("retroverse_chart_appearances").upsert(chartRow, { onConflict: "retroverse_chart_id" });
        if (chartResult.error) {
          if (isMissingColumnError(chartResult.error)) {
            const fallbackChartRow = { ...chartRow };
            delete (fallbackChartRow as { provenance_level?: ProvenanceLevel }).provenance_level;
            const fallbackResult = await supabase
              .from("retroverse_chart_appearances")
              .upsert(fallbackChartRow, { onConflict: "retroverse_chart_id" });
            if (fallbackResult.error) throw fallbackResult.error;
          } else {
            throw chartResult.error;
          }
        }
        chartByKey.set(chartKey, chartRow as ExistingChart);
        report.counts.imported.chart_appearances += 1;
      } else {
        chartId = existingChart.retroverse_chart_id;
        report.counts.reused.chart_appearances += 1;
      }

      const sourceKey = normalizeText(row.sourceKey);
      const chartSourceMatchKey = `${IMPORT_SOURCE}::${sourceKey}::chart`;
      if (!sourceMatchByUniqueKey.has(chartSourceMatchKey)) {
        const sourceMatchId = sourceMatchAllocator.allocate(`source::chart::${sourceKey}`);
        upsertSourceMatches.push({
          retroverse_source_match_id: sourceMatchId,
          source: IMPORT_SOURCE,
          source_key: sourceKey,
          source_title: row.chartName,
          source_artist: null,
          retroverse_entity_type: "chart",
          retroverse_entity_id: chartId,
          confidence_score: 1,
          manual_override: false,
          verified_by: `import:${runId}`,
          notes: "Deterministic canonical CSV import mapping.",
        });
        sourceMatchByUniqueKey.set(chartSourceMatchKey, chartId);
      }
    } catch (error) {
      const message = formatError(error);
      report.failedRows.push({ dataset: "chart_appearances", rowNumber: row.rowNumber, reason: message });
    }
  }

  if (upsertSourceMatches.length > 0) {
    const sourceMatchResult = await supabase
      .from("retroverse_source_matches")
      .upsert(upsertSourceMatches, { onConflict: "source,source_key,retroverse_entity_type" });
    if (sourceMatchResult.error) throw sourceMatchResult.error;
    report.counts.imported.source_matches += upsertSourceMatches.length;
  }

  const duplicateAlbumSourceKeys = albumsCsv
    .map((row) => normalizeText(row.sourceKey))
    .filter((key, idx, arr) => arr.indexOf(key) !== idx);
  if (duplicateAlbumSourceKeys.length > 0) {
    report.duplicateWarnings.push(`Duplicate album source keys in CSV: ${[...new Set(duplicateAlbumSourceKeys)].join(", ")}`);
  }

  const duplicateTrackSourceKeys = tracksCsv
    .map((row) => normalizeText(row.sourceKey))
    .filter((key, idx, arr) => arr.indexOf(key) !== idx);
  if (duplicateTrackSourceKeys.length > 0) {
    report.duplicateWarnings.push(`Duplicate track source keys in CSV: ${[...new Set(duplicateTrackSourceKeys)].join(", ")}`);
  }

  const duplicateChartSourceKeys = chartsCsv
    .map((row) => normalizeText(row.sourceKey))
    .filter((key, idx, arr) => arr.indexOf(key) !== idx);
  if (duplicateChartSourceKeys.length > 0) {
    report.duplicateWarnings.push(`Duplicate chart source keys in CSV: ${[...new Set(duplicateChartSourceKeys)].join(", ")}`);
  }

  report.counts.failedRows = report.failedRows.length;
  report.finishedAt = new Date().toISOString();

  await mkdir(IMPORT_LOG_ROOT, { recursive: true });
  const reportPath = path.join(IMPORT_LOG_ROOT, `${runId}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

  const humanSummary = [
    `run_id=${runId}`,
    `albums_csv_rows=${report.input.albumsRows}`,
    `tracks_csv_rows=${report.input.tracksRows}`,
    `chart_csv_rows=${report.input.chartRows}`,
    `imported=${JSON.stringify(report.counts.imported)}`,
    `reused=${JSON.stringify(report.counts.reused)}`,
    `failed_rows=${report.counts.failedRows}`,
    `duplicate_warnings=${report.duplicateWarnings.length}`,
    `ambiguities=${report.unresolvedAmbiguity.length}`,
    `report_path=${reportPath}`,
  ].join("\n");

  const summaryPath = path.join(IMPORT_LOG_ROOT, `${runId}.summary.txt`);
  await writeFile(summaryPath, `${humanSummary}\n`, "utf8");

  console.log(humanSummary);
}

main().catch(async (error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const runId = makeNowRunId();
  await mkdir(IMPORT_LOG_ROOT, { recursive: true });
  const failurePath = path.join(IMPORT_LOG_ROOT, `${runId}.fatal.txt`);
  await writeFile(failurePath, `${message}\n`, "utf8");
  console.error(message);
  process.exitCode = 1;
});
