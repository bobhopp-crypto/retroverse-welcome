import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Row = Record<string, string>;

const PACK_NAME = process.env.HERO_PACK_NAME ?? "wave1_1970s_1980s_anchor_v2";
const OUTPUT_ROOT =
  process.env.HERO_PACK_OUTPUT_ROOT ?? `/Users/bobhopp/RETROVERSE_DATA/generated/hero_packs/${PACK_NAME}`;
const TARGET_ALBUMS = Number.parseInt(process.env.HERO_PACK_TARGET_ALBUMS ?? "100", 10);
const ARTIST_CAP = Number.parseInt(process.env.HERO_PACK_ARTIST_CAP ?? "2", 10);
const COMPLETE_TRACK_THRESHOLD = Number.parseInt(process.env.HERO_PACK_COMPLETE_TRACK_THRESHOLD ?? "8", 10);
const LAYER_INPUTS = (process.env.HERO_PACK_LAYER_INPUTS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

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

function parseIntOrNull(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
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

async function parseCsv(filePath: string): Promise<Row[]> {
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
    const row: Row = {};
    headers.forEach((header, idx) => {
      row[header] = cols[idx] ?? "";
    });
    return row;
  });
}

function toCsv(headers: string[], rows: string[][]): string {
  const escapeCsv = (value: string) =>
    value.includes(",") || value.includes('"') || value.includes("\n") ? `"${value.replace(/"/g, '""')}"` : value;
  return `${[headers.join(","), ...rows.map((row) => row.map(escapeCsv).join(","))].join("\n")}\n`;
}

type CandidateAlbum = {
  sourceKey: string;
  title: string;
  artist: string;
  year: number | null;
  albumRow: Row;
  tracks: Row[];
  charts: Row[];
  score: number;
};

function scoreCandidate(candidate: CandidateAlbum): number {
  const artist = normalize(candidate.artist);
  const title = normalize(candidate.title);
  const trackCount = candidate.tracks.length;
  const chartCount = candidate.charts.length;
  const decadeBoost = candidate.year !== null && candidate.year >= 1970 && candidate.year <= 1989 ? 25 : 0;
  const anchorBoost = PRIORITY_ARTISTS.some((token) => artist.includes(token) || title.includes(token)) ? 65 : 0;
  const deepCutBoost = trackCount >= 8 ? 18 : trackCount >= 5 ? 8 : 0;
  const chartLongevityBoost = Math.min(30, chartCount);
  return decadeBoost + anchorBoost + deepCutBoost + chartLongevityBoost + trackCount * 3;
}

function getAlbumSourceKey(row: Row): string {
  return row["source_key"] ?? row["album_source_key"] ?? "";
}

async function loadLocalCandidates(): Promise<CandidateAlbum[]> {
  const albumRows = (await Promise.all(SOURCE_ALBUMS.map((p) => parseCsv(p)))).flat();
  const trackRows = (await Promise.all(SOURCE_TRACKS.map((p) => parseCsv(p)))).flat();
  const chartRows = (await Promise.all(SOURCE_CHARTS.map((p) => parseCsv(p)))).flat();

  const albumsBySource = new Map<string, Row>();
  for (const row of albumRows) {
    const sourceKey = getAlbumSourceKey(row);
    if (!sourceKey) continue;
    albumsBySource.set(normalize(sourceKey), row);
  }

  const tracksByAlbum = new Map<string, Row[]>();
  for (const row of trackRows) {
    const albumSourceKey = row["album_source_key"] ?? "";
    if (!albumSourceKey) continue;
    const key = normalize(albumSourceKey);
    const current = tracksByAlbum.get(key) ?? [];
    current.push(row);
    tracksByAlbum.set(key, current);
  }

  const chartsByTrack = new Map<string, Row[]>();
  for (const row of chartRows) {
    const trackSourceKey = row["track_source_key"] ?? "";
    if (!trackSourceKey) continue;
    const key = normalize(trackSourceKey);
    const current = chartsByTrack.get(key) ?? [];
    current.push(row);
    chartsByTrack.set(key, current);
  }

  const candidates: CandidateAlbum[] = [];
  for (const [albumKey, tracks] of tracksByAlbum.entries()) {
    const album = albumsBySource.get(albumKey);
    if (!album) continue;
    const orderedTracks = [...tracks]
      .filter((row) => parseIntOrNull(row["track_number"]) !== null && parseIntOrNull(row["track_number"])! > 0)
      .sort(
        (a, b) =>
          (parseIntOrNull(a["disc_number"]) ?? 1) - (parseIntOrNull(b["disc_number"]) ?? 1) ||
          (parseIntOrNull(a["track_number"]) ?? 0) - (parseIntOrNull(b["track_number"]) ?? 0),
      );
    if (orderedTracks.length < 2) continue;
    const charts = orderedTracks.flatMap((track) => chartsByTrack.get(normalize(track["source_key"] ?? "")) ?? []);
    const candidate: CandidateAlbum = {
      sourceKey: getAlbumSourceKey(album),
      title: album["canonical_album_title"] || album["title"] || album["album_title"] || "",
      artist: album["canonical_album_artist"] || album["album_artist"] || album["artist_name"] || "",
      year: parseIntOrNull(album["release_year"] ?? album["year"]),
      albumRow: album,
      tracks: orderedTracks,
      charts,
      score: 0,
    };
    candidate.score = scoreCandidate(candidate);
    candidates.push(candidate);
  }
  candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return candidates;
}

function selectDiverse(candidates: CandidateAlbum[]): CandidateAlbum[] {
  const selected: CandidateAlbum[] = [];
  const artistCounts = new Map<string, number>();
  const decadeCounts = new Map<string, number>();
  const decadeCap = Math.max(6, Math.ceil(TARGET_ALBUMS / 4));
  for (const candidate of candidates) {
    if (selected.length >= TARGET_ALBUMS) break;
    const artistKey = normalize(candidate.artist);
    const decade = candidate.year !== null ? `${Math.floor(candidate.year / 10) * 10}s` : "unknown";
    if ((artistCounts.get(artistKey) ?? 0) >= ARTIST_CAP) continue;
    if ((decadeCounts.get(decade) ?? 0) >= decadeCap) continue;
    selected.push(candidate);
    artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
  }
  return selected;
}

async function loadLayerRows(layerDir: string, fileName: string): Promise<Row[]> {
  return parseCsv(path.join(layerDir, fileName));
}

function mergeByKey(base: Row[], incoming: Row[], keyField: string): Row[] {
  const out = new Map<string, Row>();
  for (const row of base) {
    const key = normalize(row[keyField] ?? "");
    if (!key) continue;
    out.set(key, row);
  }
  for (const row of incoming) {
    const key = normalize(row[keyField] ?? "");
    if (!key) continue;
    if (!out.has(key)) out.set(key, row);
  }
  return [...out.values()];
}

function analyzeManifest(albums: Row[], tracks: Row[], artworkQueries: Row[]) {
  const trackCountByAlbum = new Map<string, number>();
  for (const track of tracks) {
    const albumKey = normalize(track["album_source_key"] ?? "");
    if (!albumKey) continue;
    trackCountByAlbum.set(albumKey, (trackCountByAlbum.get(albumKey) ?? 0) + 1);
  }
  const complete = [...trackCountByAlbum.values()].filter((count) => count >= COMPLETE_TRACK_THRESHOLD).length;
  const sequencingCompletenessPct = albums.length > 0 ? Number(((complete / albums.length) * 100).toFixed(2)) : 0;

  const presentArtists = new Set(albums.map((row) => normalize(row["canonical_album_artist"] || row["album_artist"] || "")));
  const priorityPresent = PRIORITY_ARTISTS.filter((token) => [...presentArtists].some((artist) => artist.includes(token)));
  const priorityCoveragePct = Number(((priorityPresent.length / PRIORITY_ARTISTS.length) * 100).toFixed(2));

  const artworkReady = artworkQueries.filter((row) => (row["itunes_query"] ?? "").trim().length > 0).length;
  const artworkAcquisitionReadinessPct = albums.length > 0 ? Number(((artworkReady / albums.length) * 100).toFixed(2)) : 0;

  const uniqueArtists = new Set(albums.map((row) => normalize(row["canonical_album_artist"] || row["album_artist"] || ""))).size;
  const artistDiversityPct = albums.length > 0 ? Number(((uniqueArtists / albums.length) * 100).toFixed(2)) : 0;

  const emotionalCoverageEstimate = Number(
    (priorityCoveragePct * 0.45 + sequencingCompletenessPct * 0.35 + artistDiversityPct * 0.2).toFixed(2),
  );

  return {
    emotionalCoverageEstimate,
    sequencingCompletenessPct,
    artworkAcquisitionReadinessPct,
    priorityArtistCoverage: {
      requested: PRIORITY_ARTISTS.length,
      present: priorityPresent.length,
      pct: priorityCoveragePct,
      missing: PRIORITY_ARTISTS.filter((token) => !priorityPresent.includes(token)),
    },
  };
}

async function main() {
  const candidates = await loadLocalCandidates();
  const selected = selectDiverse(candidates);

  const selectedAlbumRows = selected.map((candidate) => candidate.albumRow);
  const selectedTrackRows = selected.flatMap((candidate) => candidate.tracks);
  const selectedChartRows = selected.flatMap((candidate) => candidate.charts);
  const selectedArtworkRows = selected.map((candidate) => ({
    album_source_key: candidate.sourceKey,
    canonical_album_artist: candidate.artist,
    canonical_album_title: candidate.title,
    release_year: candidate.year !== null ? String(candidate.year) : "",
    itunes_query: `${candidate.artist} ${candidate.title}`.replace(/\s+/g, " ").trim(),
    discogs_query: `${candidate.artist} ${candidate.title} ${candidate.year ?? ""}`.replace(/\s+/g, " ").trim(),
    normalized_artist: normalize(candidate.artist),
    normalized_album: normalize(candidate.title),
    priority_label: "core_canon_candidate",
  }));

  const layerAlbumRows = (await Promise.all(LAYER_INPUTS.map((dir) => loadLayerRows(dir, "albums.csv")))).flat();
  const layerTrackRows = (await Promise.all(LAYER_INPUTS.map((dir) => loadLayerRows(dir, "tracks.csv")))).flat();
  const layerChartRows = (await Promise.all(LAYER_INPUTS.map((dir) => loadLayerRows(dir, "chart_appearances.csv")))).flat();
  const layerArtworkRows = (await Promise.all(LAYER_INPUTS.map((dir) => loadLayerRows(dir, "artwork_queries.csv")))).flat();

  const mergedAlbums = mergeByKey(layerAlbumRows, selectedAlbumRows, "source_key");
  const mergedTracks = mergeByKey(layerTrackRows, selectedTrackRows, "source_key");
  const mergedCharts = mergeByKey(layerChartRows, selectedChartRows, "source_key");
  const mergedArtwork = mergeByKey(layerArtworkRows, selectedArtworkRows, "album_source_key");

  const metrics = analyzeManifest(mergedAlbums, mergedTracks, mergedArtwork);
  const manifest = {
    generatedAt: new Date().toISOString(),
    packName: PACK_NAME,
    outputRoot: OUTPUT_ROOT,
    targetAlbums: TARGET_ALBUMS,
    selectedThisRun: selected.length,
    layeredInputs: LAYER_INPUTS,
    mergedTotals: {
      albums: mergedAlbums.length,
      tracks: mergedTracks.length,
      chartRows: mergedCharts.length,
      artworkQueries: mergedArtwork.length,
    },
    metrics,
    sourcePaths: { albums: SOURCE_ALBUMS, tracks: SOURCE_TRACKS, charts: SOURCE_CHARTS },
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
        mergedAlbums.map((row) => [
          row["source_key"] ?? "",
          row["canonical_album_title"] || row["title"] || row["album_title"] || "",
          row["canonical_album_artist"] || row["album_artist"] || row["artist_name"] || "",
          row["release_year"] || row["year"] || "",
          row["album_type"] || "studio",
          row["soundtrack_flag"] || "false",
          row["era_slug"] || "",
          row["release_date"] || "",
          row["notes"] || "Hero pack canonical sequencing.",
          row["source_title"] || row["canonical_album_title"] || row["title"] || "",
          row["source_artist"] || row["canonical_album_artist"] || row["album_artist"] || "",
          row["edition_key"] || "",
          row["edition_name"] || "Primary canonical edition",
          row["edition_release_date"] || "",
          row["edition_release_year"] || row["release_year"] || "",
          row["provenance_level"] || "canonicalized",
        ]),
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
        mergedTracks.map((row) => [
          row["source_key"] ?? "",
          row["album_source_key"] ?? "",
          row["album_title"] || "",
          row["album_artist"] || "",
          row["canonical_title"] || row["track_title"] || row["title"] || "",
          row["canonical_artist_name"] || row["artist_name"] || row["album_artist"] || "",
          row["release_year"] || "",
          row["disc_number"] || "1",
          row["track_number"] || "0",
          row["side_code"] || "",
          row["side_position"] || "",
          row["soundtrack_exclusive"] || "false",
          row["is_interlude"] || "false",
          row["notes"] || "",
          row["provenance_level"] || "canonicalized",
        ]),
      ),
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_ROOT, "chart_appearances.csv"),
      toCsv(
        ["source_key", "track_source_key", "chart_date", "chart_name", "chart_position", "weeks_on_chart", "provenance_level"],
        mergedCharts.map((row) => [
          row["source_key"] ?? "",
          row["track_source_key"] ?? "",
          row["chart_date"] ?? "",
          row["chart_name"] || "Billboard Hot 100",
          row["chart_position"] || "",
          row["weeks_on_chart"] || "",
          row["provenance_level"] || "verified",
        ]),
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
        mergedArtwork.map((row) => [
          row["album_source_key"] ?? "",
          row["canonical_album_artist"] ?? "",
          row["canonical_album_title"] ?? "",
          row["release_year"] ?? "",
          row["itunes_query"] ?? "",
          row["discogs_query"] ?? "",
          row["normalized_artist"] ?? "",
          row["normalized_album"] ?? "",
          row["priority_label"] || "hero_pack_priority",
        ]),
      ),
      "utf8",
    ),
    writeFile(path.join(OUTPUT_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8"),
  ]);

  console.log("\nCanonical Hero Pack (Layered) Generated");
  console.log(`output_root: ${OUTPUT_ROOT}`);
  console.log(`selected_this_run: ${selected.length}`);
  console.log(`merged_albums: ${manifest.mergedTotals.albums}`);
  console.log(`merged_tracks: ${manifest.mergedTotals.tracks}`);
  console.log(`emotional_coverage_estimate: ${manifest.metrics.emotionalCoverageEstimate}`);
  console.log(`sequencing_completeness_pct: ${manifest.metrics.sequencingCompletenessPct}`);
  console.log(`artwork_acquisition_readiness_pct: ${manifest.metrics.artworkAcquisitionReadinessPct}`);
}

main().catch((error) => {
  console.error("generate_canonical_hero_pack_layered_failed:", error);
  process.exitCode = 1;
});
