import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type AlbumCsvRow = {
  sourceKey: string;
  title: string;
  albumArtist: string;
  releaseYear: number | null;
  albumType: string;
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
  provenanceLevel: string;
};

type TrackCsvRow = {
  sourceKey: string;
  albumSourceKey: string;
  albumTitle: string;
  albumArtist: string;
  canonicalTitle: string;
  canonicalArtistName: string;
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
  provenanceLevel: string;
};

type ChartCsvRow = {
  sourceKey: string;
  trackSourceKey: string | null;
  chartDate: string;
  chartName: string;
  chartPosition: number | null;
  weeksOnChart: number | null;
  provenanceLevel: string;
};

type AlbumBundle = {
  album: AlbumCsvRow;
  tracks: TrackCsvRow[];
  charts: ChartCsvRow[];
  score: number;
};

const OUTPUT_ROOT =
  process.env.HERO_PACK_OUTPUT_ROOT ??
  "/Users/bobhopp/RETROVERSE_DATA/generated/hero_packs/wave1_1970s_1980s_anchor_v1";
const TARGET_ALBUMS = Number.parseInt(process.env.HERO_PACK_TARGET_ALBUMS ?? "500", 10);

const SOURCE_ALBUMS = [
  "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/data/imports/canonical_1977_1979/albums.csv",
  "/Users/bobhopp/RETROVERSE_DATA/imports/canonical/albums.csv",
];
const SOURCE_TRACKS = [
  "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/data/imports/canonical_1977_1979/tracks.csv",
  "/Users/bobhopp/RETROVERSE_DATA/imports/canonical/tracks.csv",
];
const SOURCE_CHARTS = [
  "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/data/imports/canonical_1977_1979/chart_appearances.csv",
  "/Users/bobhopp/RETROVERSE_DATA/imports/canonical/chart_appearances.csv",
];

const PRIORITY_ARTISTS = [
  "fleetwood mac",
  "eagles",
  "queen",
  "elton john",
  "michael jackson",
  "prince",
  "led zeppelin",
  "beatles",
  "billy joel",
  "boston",
  "supertramp",
  "journey",
  "steely dan",
  "pink floyd",
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

function parseIntOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "y"].includes(normalize(value));
}

async function parseCsv(filePath: string): Promise<Record<string, string>[]> {
  let raw = "";
  try {
    raw = await readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => normalize(header));
  return lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    return row;
  });
}

function toCsv(headers: string[], rows: string[][]): string {
  const esc = (value: string) => {
    if (value.includes(",") || value.includes('"') || value.includes("\n")) return `"${value.replace(/"/g, '""')}"`;
    return value;
  };
  return `${[headers.join(","), ...rows.map((row) => row.map(esc).join(","))].join("\n")}\n`;
}

function scoreBundle(bundle: AlbumBundle): number {
  const artist = normalize(bundle.album.albumArtist);
  const title = normalize(bundle.album.title);
  let score = 0;
  if (bundle.album.releaseYear !== null && bundle.album.releaseYear >= 1970 && bundle.album.releaseYear <= 1989) score += 30;
  score += bundle.tracks.length * 4;
  score += Math.min(30, bundle.charts.length);
  if (PRIORITY_ARTISTS.some((name) => artist.includes(name) || title.includes(name))) score += 70;
  if (title.includes("greatest hits") || title.includes("best of")) score += 8;
  return score;
}

async function main() {
  const albumRows = (await Promise.all(SOURCE_ALBUMS.map((p) => parseCsv(p)))).flat();
  const trackRows = (await Promise.all(SOURCE_TRACKS.map((p) => parseCsv(p)))).flat();
  const chartRows = (await Promise.all(SOURCE_CHARTS.map((p) => parseCsv(p)))).flat();

  const albums = new Map<string, AlbumCsvRow>();
  for (const row of albumRows) {
    const sourceKey = row["source_key"] ?? row["album_source_key"] ?? "";
    if (!sourceKey) continue;
    albums.set(normalize(sourceKey), {
      sourceKey,
      title: row["canonical_album_title"] || row["title"] || row["album_title"] || "",
      albumArtist: row["canonical_album_artist"] || row["album_artist"] || row["artist_name"] || "",
      releaseYear: parseIntOrNull(row["release_year"] ?? row["year"]),
      albumType: row["album_type"] || "studio",
      soundtrackFlag: parseBoolean(row["soundtrack_flag"]),
      eraSlug: row["era_slug"] || null,
      releaseDate: row["release_date"] || null,
      notes: row["notes"] || null,
      sourceTitle: row["source_title"] || null,
      sourceArtist: row["source_artist"] || null,
      editionKey: row["edition_key"] || `primary-${parseIntOrNull(row["release_year"] ?? row["year"]) ?? "unknown"}`,
      editionName: row["edition_name"] || "Primary canonical edition",
      editionReleaseDate: row["edition_release_date"] || row["release_date"] || null,
      editionReleaseYear: parseIntOrNull(row["edition_release_year"] ?? row["release_year"] ?? row["year"]),
      provenanceLevel: row["provenance_level"] || "canonicalized",
    });
  }

  const tracksByAlbum = new Map<string, TrackCsvRow[]>();
  for (const row of trackRows) {
    const albumSourceKey = row["album_source_key"] ?? "";
    if (!albumSourceKey) continue;
    const normalizedAlbumSource = normalize(albumSourceKey);
    const mapped: TrackCsvRow = {
      sourceKey: row["source_key"] ?? row["track_source_key"] ?? "",
      albumSourceKey,
      albumTitle: row["album_title"] || row["canonical_album_title"] || "",
      albumArtist: row["album_artist"] || row["canonical_album_artist"] || "",
      canonicalTitle: row["canonical_title"] || row["track_title"] || row["title"] || "",
      canonicalArtistName: row["canonical_artist_name"] || row["artist_name"] || row["album_artist"] || "",
      releaseYear: parseIntOrNull(row["release_year"] ?? row["year"]),
      discNumber: parseIntOrNull(row["disc_number"]) ?? 1,
      trackNumber: parseIntOrNull(row["track_number"]) ?? 0,
      sideCode: row["side_code"] || null,
      sidePosition: parseIntOrNull(row["side_position"]),
      soundtrackExclusive: parseBoolean(row["soundtrack_exclusive"]),
      isInterlude: parseBoolean(row["is_interlude"]),
      notes: row["notes"] || null,
      sourceTitle: row["source_title"] || null,
      sourceArtist: row["source_artist"] || null,
      provenanceLevel: row["provenance_level"] || "canonicalized",
    };
    if (!mapped.sourceKey || !mapped.canonicalTitle || mapped.trackNumber <= 0) continue;
    const current = tracksByAlbum.get(normalizedAlbumSource) ?? [];
    current.push(mapped);
    tracksByAlbum.set(normalizedAlbumSource, current);
  }

  const chartsByTrack = new Map<string, ChartCsvRow[]>();
  for (const row of chartRows) {
    const trackSourceKey = row["track_source_key"] ?? "";
    if (!trackSourceKey) continue;
    const mapped: ChartCsvRow = {
      sourceKey: row["source_key"] ?? row["chart_source_key"] ?? "",
      trackSourceKey,
      chartDate: row["chart_date"] ?? "",
      chartName: row["chart_name"] || "Billboard Hot 100",
      chartPosition: parseIntOrNull(row["chart_position"]),
      weeksOnChart: parseIntOrNull(row["weeks_on_chart"]),
      provenanceLevel: row["provenance_level"] || "verified",
    };
    const current = chartsByTrack.get(normalize(trackSourceKey)) ?? [];
    current.push(mapped);
    chartsByTrack.set(normalize(trackSourceKey), current);
  }

  const bundles: AlbumBundle[] = [];
  for (const [albumSourceKeyNorm, tracks] of tracksByAlbum.entries()) {
    const album = albums.get(albumSourceKeyNorm);
    if (!album) continue;
    const orderedTracks = [...tracks].sort((a, b) => a.discNumber - b.discNumber || a.trackNumber - b.trackNumber);
    if (orderedTracks.length < 2) continue;
    const charts = orderedTracks.flatMap((track) => chartsByTrack.get(normalize(track.sourceKey)) ?? []);
    const bundle: AlbumBundle = { album, tracks: orderedTracks, charts, score: 0 };
    bundle.score = scoreBundle(bundle);
    bundles.push(bundle);
  }

  bundles.sort((a, b) => b.score - a.score || a.album.title.localeCompare(b.album.title));
  const selected = bundles.slice(0, TARGET_ALBUMS);

  const albumRowsOut: string[][] = [];
  const trackRowsOut: string[][] = [];
  const chartRowsOut: string[][] = [];
  const artworkRowsOut: string[][] = [];

  for (const bundle of selected) {
    albumRowsOut.push([
      bundle.album.sourceKey,
      bundle.album.title,
      bundle.album.albumArtist,
      bundle.album.releaseYear !== null ? String(bundle.album.releaseYear) : "",
      bundle.album.albumType,
      bundle.album.soundtrackFlag ? "true" : "false",
      bundle.album.eraSlug ?? "",
      bundle.album.releaseDate ?? "",
      bundle.album.notes ?? "Hero album pack canonical sequencing.",
      bundle.album.sourceTitle ?? bundle.album.title,
      bundle.album.sourceArtist ?? bundle.album.albumArtist,
      bundle.album.editionKey,
      bundle.album.editionName,
      bundle.album.editionReleaseDate ?? "",
      bundle.album.editionReleaseYear !== null ? String(bundle.album.editionReleaseYear) : "",
      bundle.album.provenanceLevel,
    ]);
    for (const track of bundle.tracks) {
      trackRowsOut.push([
        track.sourceKey,
        track.albumSourceKey,
        track.albumTitle,
        track.albumArtist,
        track.canonicalTitle,
        track.canonicalArtistName,
        track.releaseYear !== null ? String(track.releaseYear) : "",
        String(track.discNumber),
        String(track.trackNumber),
        track.sideCode ?? "",
        track.sidePosition !== null ? String(track.sidePosition) : "",
        track.soundtrackExclusive ? "true" : "false",
        track.isInterlude ? "true" : "false",
        track.notes ?? "",
        track.provenanceLevel,
      ]);
      for (const chart of bundle.charts.filter((row) => normalize(row.trackSourceKey ?? "") === normalize(track.sourceKey))) {
        chartRowsOut.push([
          chart.sourceKey || `${track.sourceKey}::${chart.chartDate}::${chart.chartPosition ?? "na"}`,
          track.sourceKey,
          chart.chartDate,
          chart.chartName,
          chart.chartPosition !== null ? String(chart.chartPosition) : "",
          chart.weeksOnChart !== null ? String(chart.weeksOnChart) : "",
          chart.provenanceLevel,
        ]);
      }
    }
    artworkRowsOut.push([
      bundle.album.sourceKey,
      bundle.album.albumArtist,
      bundle.album.title,
      bundle.album.releaseYear !== null ? String(bundle.album.releaseYear) : "",
      `${bundle.album.albumArtist} ${bundle.album.title}`.replace(/\s+/g, " ").trim(),
      `${bundle.album.albumArtist} ${bundle.album.title} ${bundle.album.releaseYear ?? ""}`.replace(/\s+/g, " ").trim(),
      normalize(bundle.album.albumArtist),
      normalize(bundle.album.title),
      "hero_pack_priority",
    ]);
  }

  const presentPriorityArtists = new Set(selected.map((bundle) => normalize(bundle.album.albumArtist)));
  const missingPriorityArtists = PRIORITY_ARTISTS.filter((artist) => ![...presentPriorityArtists].some((present) => present.includes(artist)));

  const manifest = {
    generatedAt: new Date().toISOString(),
    outputRoot: OUTPUT_ROOT,
    targetAlbums: TARGET_ALBUMS,
    selectedAlbums: selected.length,
    selectedTracks: trackRowsOut.length,
    selectedChartRows: chartRowsOut.length,
    sourcePaths: { albums: SOURCE_ALBUMS, tracks: SOURCE_TRACKS, charts: SOURCE_CHARTS },
    priorityArtistsRequested: PRIORITY_ARTISTS,
    priorityArtistsPresent: [...new Set(selected.map((bundle) => bundle.album.albumArtist))],
    priorityArtistsMissing: missingPriorityArtists,
    notes: [
      "Hero pack is local-source-only and import-ready.",
      "Albums require >=2 ordered tracks to be included.",
      "Artwork queries are acquisition-ready hints, not canonical truth.",
    ],
  };

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(OUTPUT_ROOT, "albums.csv"),
      toCsv(
        [
          "source_key",
          "canonical_album_title",
          "canonical_album_artist",
          "release_year",
          "album_type",
          "soundtrack_flag",
          "era_slug",
          "release_date",
          "notes",
          "source_title",
          "source_artist",
          "edition_key",
          "edition_name",
          "edition_release_date",
          "edition_release_year",
          "provenance_level",
        ],
        albumRowsOut,
      ),
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_ROOT, "tracks.csv"),
      toCsv(
        [
          "source_key",
          "album_source_key",
          "album_title",
          "album_artist",
          "canonical_title",
          "canonical_artist_name",
          "release_year",
          "disc_number",
          "track_number",
          "side_code",
          "side_position",
          "soundtrack_exclusive",
          "is_interlude",
          "notes",
          "provenance_level",
        ],
        trackRowsOut,
      ),
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_ROOT, "chart_appearances.csv"),
      toCsv(
        ["source_key", "track_source_key", "chart_date", "chart_name", "chart_position", "weeks_on_chart", "provenance_level"],
        chartRowsOut,
      ),
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_ROOT, "artwork_queries.csv"),
      toCsv(
        [
          "album_source_key",
          "canonical_album_artist",
          "canonical_album_title",
          "release_year",
          "itunes_query",
          "discogs_query",
          "normalized_artist",
          "normalized_album",
          "priority_label",
        ],
        artworkRowsOut,
      ),
      "utf8",
    ),
    writeFile(path.join(OUTPUT_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8"),
  ]);

  console.log("\nCanonical Hero Pack Generated");
  console.log(`output_root: ${OUTPUT_ROOT}`);
  console.log(`albums: ${albumRowsOut.length}`);
  console.log(`tracks: ${trackRowsOut.length}`);
  console.log(`chart_rows: ${chartRowsOut.length}`);
  console.log(`priority_artists_present: ${manifest.priorityArtistsPresent.length}`);
  console.log(`priority_artists_missing: ${manifest.priorityArtistsMissing.length}`);
}

main().catch((error) => {
  console.error("generate_canonical_hero_pack_failed:", error);
  process.exitCode = 1;
});
