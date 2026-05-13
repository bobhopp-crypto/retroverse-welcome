import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

type ChartTrackStats = {
  key: string;
  title: string;
  artist: string;
  normalizedArtist: string;
  normalizedTitle: string;
  appearances: number;
  bestPeak: number;
  maxWeeksOnChart: number;
  totalRank: number;
  years: Set<number>;
  appearancesByDecade: Map<string, number>;
};

type ArtistStats = {
  artist: string;
  normalizedArtist: string;
  appearances: number;
  bestPeak: number;
  years: Set<number>;
  distinctTrackCount: number;
  trackKeys: Set<string>;
  score: number;
};

type EraRecord = {
  slug: string;
  years: string;
  title: string;
};

type CandidateTrack = {
  title: string;
  artist: string;
  normalizedTitle: string;
  normalizedArtist: string;
  bestPeak: number;
  maxWeeksOnChart: number;
  representativeYear: number | null;
  appearances: number;
  sourceTrackKey: string;
};

type CandidateAlbum = {
  candidateKey: string;
  title: string;
  artist: string;
  normalizedTitle: string;
  normalizedArtist: string;
  releaseYear: number | null;
  albumType: "studio" | "soundtrack" | "compilation" | "live" | "other";
  soundtrackFlag: boolean;
  eraSlug: string | null;
  decade: string;
  tracks: CandidateTrack[];
  baseScore: number;
  sourceTag: "canonical_seed" | "chart_inferred";
  notes: string;
  genreBucket: string | null;
  isCulturalAnchor: boolean;
};

type ProbeResult = {
  probe: string;
  included: boolean;
  matchedArtists: string[];
};

const CHART_SOURCE_PATH =
  process.env.RETROVERSE_CHART_SOURCE ?? "/Users/bobhopp/RETROVERSE_DATA/billboard/chart_all_years.csv";
const CANONICAL_IMPORT_ROOT =
  process.env.RETROVERSE_CANONICAL_IMPORT_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/imports/canonical";
const OUTPUT_ROOT =
  process.env.RETROVERSE_DISCOVER_GENERATED_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/generated/discover_wave1a";
const TARGET_ALBUMS = Number.parseInt(process.env.DISCOVER_TARGET_ALBUMS ?? "800", 10);
const MAX_ALBUMS_PER_ARTIST = Number.parseInt(process.env.DISCOVER_MAX_ALBUMS_PER_ARTIST ?? "2", 10);
const WRITE_ACQUISITION_PREP = (process.env.DISCOVER_WRITE_ACQUISITION_PREP ?? "true").toLowerCase() !== "false";

const REQUIRED_PROBE_ARTISTS = [
  "Def Leppard",
  "Led Zeppelin",
  "Michael Jackson",
  "Prince",
  "Fleetwood Mac",
  "Eagles",
  "Beatles",
  "Elton John",
  "Queen",
] as const;

const CULTURAL_ANCHOR_ALBUMS: Array<{ artist: string; title: string; year: number; albumType?: "studio" | "soundtrack" | "compilation" | "live" }> =
  [
    { artist: "Michael Jackson", title: "Thriller", year: 1982 },
    { artist: "Prince", title: "Purple Rain", year: 1984, albumType: "soundtrack" },
    { artist: "Led Zeppelin", title: "Led Zeppelin IV", year: 1971 },
    { artist: "Def Leppard", title: "Pyromania", year: 1983 },
    { artist: "Eagles", title: "Hotel California", year: 1976 },
    { artist: "Fleetwood Mac", title: "Rumours", year: 1977 },
    { artist: "The Beatles", title: "Abbey Road", year: 1969 },
    { artist: "Elton John", title: "Goodbye Yellow Brick Road", year: 1973 },
    { artist: "Queen", title: "A Night at the Opera", year: 1975 },
  ];

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeSlug(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeNameToken(value: string): string {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decadeForYear(year: number | null): string {
  if (!year || !Number.isFinite(year)) return "unknown";
  return `${Math.floor(year / 10) * 10}s`;
}

function parseYearFromDate(value: string): number | null {
  if (!value || value.length < 4) return null;
  const year = Number.parseInt(value.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
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

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreTrack(track: ChartTrackStats, artistStats: ArtistStats): number {
  const crossDecade = Math.max(1, track.appearancesByDecade.size);
  const normalizedPeak = 101 - Math.min(100, track.bestPeak);
  return (
    track.appearances * 1.1 +
    normalizedPeak * 1.8 +
    track.maxWeeksOnChart * 0.65 +
    crossDecade * 4 +
    Math.sqrt(Math.max(1, artistStats.appearances)) * 1.2
  );
}

function scoreArtist(stats: ArtistStats): number {
  const crossDecade = Math.max(1, new Set([...stats.years].map((year) => Math.floor(year / 10))).size);
  const normalizedPeak = 101 - Math.min(100, stats.bestPeak);
  return stats.appearances * 0.22 + stats.distinctTrackCount * 1.2 + crossDecade * 3.5 + normalizedPeak * 1.4;
}

function eraSlugForYear(eras: EraRecord[], year: number | null): string | null {
  if (!year) return null;
  for (const era of eras) {
    const [startRaw, endRaw] = era.years.split("-").map((item) => item.trim());
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    if (Number.isFinite(start) && Number.isFinite(end) && year >= start && year <= end) return era.slug;
  }
  return null;
}

async function loadEras(): Promise<EraRecord[]> {
  const erasPath = path.join(process.cwd(), "data/eras.json");
  const raw = await readFile(erasPath, "utf8");
  const parsed = JSON.parse(raw) as { eras?: EraRecord[] };
  return parsed.eras ?? [];
}

async function parseSimpleCsv(filePath: string): Promise<Record<string, string>[]> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

async function buildChartStats() {
  const headerByName = new Map<string, number>();
  const trackStatsByKey = new Map<string, ChartTrackStats>();
  const artistStatsByKey = new Map<string, ArtistStats>();
  const chartRowsByDecade = new Map<string, number>();

  const stream = createReadStream(CHART_SOURCE_PATH, { encoding: "utf8" });
  const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let rowIndex = 0;
  for await (const line of reader) {
    if (!line || line.trim().length === 0) continue;
    const cells = splitCsvLine(line);
    if (rowIndex === 0) {
      cells.forEach((header, idx) => headerByName.set(normalizeText(header), idx));
      rowIndex += 1;
      continue;
    }
    rowIndex += 1;

    const chartDate = cells[headerByName.get("chart_date") ?? -1] ?? "";
    const title = cells[headerByName.get("title") ?? -1] ?? "";
    const artist = cells[headerByName.get("artist") ?? -1] ?? "";
    const rankRaw = cells[headerByName.get("rank") ?? -1] ?? "";
    const peakRaw = cells[headerByName.get("peak_position") ?? -1] ?? "";
    const weeksRaw = cells[headerByName.get("weeks_on_chart") ?? -1] ?? "";

    const normalizedTitle = normalizeText(title);
    const normalizedArtist = normalizeText(artist);
    if (!normalizedTitle || !normalizedArtist) continue;

    const rank = parseInteger(rankRaw) ?? 100;
    const peak = parseInteger(peakRaw) ?? rank;
    const weeksOnChart = parseInteger(weeksRaw) ?? 1;
    const year = parseYearFromDate(chartDate);
    const decade = decadeForYear(year);
    chartRowsByDecade.set(decade, (chartRowsByDecade.get(decade) ?? 0) + 1);

    const trackKey = `${normalizedArtist}::${normalizedTitle}`;
    const track = trackStatsByKey.get(trackKey) ?? {
      key: trackKey,
      title: title.trim(),
      artist: artist.trim(),
      normalizedArtist,
      normalizedTitle,
      appearances: 0,
      bestPeak: 100,
      maxWeeksOnChart: 1,
      totalRank: 0,
      years: new Set<number>(),
      appearancesByDecade: new Map<string, number>(),
    };
    track.appearances += 1;
    track.bestPeak = Math.min(track.bestPeak, peak);
    track.maxWeeksOnChart = Math.max(track.maxWeeksOnChart, weeksOnChart);
    track.totalRank += rank;
    if (year) track.years.add(year);
    track.appearancesByDecade.set(decade, (track.appearancesByDecade.get(decade) ?? 0) + 1);
    trackStatsByKey.set(trackKey, track);

    const artistStats = artistStatsByKey.get(normalizedArtist) ?? {
      artist: artist.trim(),
      normalizedArtist,
      appearances: 0,
      bestPeak: 100,
      years: new Set<number>(),
      distinctTrackCount: 0,
      trackKeys: new Set<string>(),
      score: 0,
    };
    artistStats.appearances += 1;
    artistStats.bestPeak = Math.min(artistStats.bestPeak, peak);
    if (year) artistStats.years.add(year);
    if (!artistStats.trackKeys.has(trackKey)) {
      artistStats.trackKeys.add(trackKey);
      artistStats.distinctTrackCount += 1;
    }
    artistStatsByKey.set(normalizedArtist, artistStats);
  }

  for (const stats of artistStatsByKey.values()) {
    stats.score = scoreArtist(stats);
  }

  return { trackStatsByKey, artistStatsByKey, chartRowsByDecade };
}

function resolveGenreBucket(title: string): string | null {
  const normalized = normalizeText(title);
  if (normalized.includes("soundtrack")) return "soundtrack";
  if (normalized.includes("live")) return "live";
  if (normalized.includes("greatest") || normalized.includes("best of") || normalized.includes("hits")) return "compilation";
  return null;
}

function artistMatchesProbe(artist: string, probe: string): boolean {
  const artistToken = normalizeNameToken(artist);
  const probeToken = normalizeNameToken(probe);
  if (!artistToken || !probeToken) return false;
  if (artistToken === probeToken || artistToken === `the ${probeToken}`) return true;
  if (probeToken.includes(" ")) return artistToken.startsWith(`${probeToken} `);
  return (
    artistToken.startsWith(`${probeToken} and `) ||
    artistToken.startsWith(`${probeToken} & `) ||
    artistToken.startsWith(`${probeToken} the `)
  );
}

function isCulturalAnchorArtist(artist: string): boolean {
  return REQUIRED_PROBE_ARTISTS.some((probe) => artistMatchesProbe(artist, probe));
}

function buildCandidateKey(artist: string, title: string, year: number | null): string {
  return `${normalizeSlug(artist)}::${normalizeSlug(title)}::${year ?? "unknown"}`;
}

async function buildSeedCandidates(
  eras: EraRecord[],
  trackStatsByKey: Map<string, ChartTrackStats>,
): Promise<CandidateAlbum[]> {
  const albumsPath = path.join(CANONICAL_IMPORT_ROOT, "albums.csv");
  const tracksPath = path.join(CANONICAL_IMPORT_ROOT, "tracks.csv");

  const albumRows = await parseSimpleCsv(albumsPath);
  const trackRows = await parseSimpleCsv(tracksPath);
  const tracksByAlbumSource = new Map<string, Record<string, string>[]>();
  for (const row of trackRows) {
    const albumSourceKey = row.album_source_key?.trim();
    if (!albumSourceKey) continue;
    const current = tracksByAlbumSource.get(albumSourceKey) ?? [];
    current.push(row);
    tracksByAlbumSource.set(albumSourceKey, current);
  }

  const candidates: CandidateAlbum[] = [];
  for (const album of albumRows) {
    const artist = (album.album_artist ?? "").trim();
    const title = (album.title ?? "").trim();
    if (!artist || !title) continue;
    const year = parseInteger(album.release_year) ?? null;
    const albumSourceKey = (album.source_key ?? "").trim();
    const rawTracks = tracksByAlbumSource.get(albumSourceKey) ?? [];

    const candidateTracks: CandidateTrack[] = rawTracks
      .map((track) => {
        const trackTitle = (track.canonical_title ?? "").trim();
        const trackArtist = (track.canonical_artist_name ?? artist).trim();
        const normalizedTrackKey = `${normalizeText(trackArtist)}::${normalizeText(trackTitle)}`;
        const stats = trackStatsByKey.get(normalizedTrackKey);
        const representativeYear = stats?.years.size ? Math.min(...stats.years) : year;
        return {
          title: trackTitle,
          artist: trackArtist,
          normalizedTitle: normalizeText(trackTitle),
          normalizedArtist: normalizeText(trackArtist),
          bestPeak: stats?.bestPeak ?? 100,
          maxWeeksOnChart: stats?.maxWeeksOnChart ?? 1,
          representativeYear,
          appearances: stats?.appearances ?? 1,
          sourceTrackKey: normalizedTrackKey,
        };
      })
      .filter((track) => track.title.length > 0)
      .slice(0, 14);

    if (candidateTracks.length === 0) continue;
    const avgPeak = candidateTracks.reduce((sum, track) => sum + track.bestPeak, 0) / candidateTracks.length;
    const totalAppearances = candidateTracks.reduce((sum, track) => sum + track.appearances, 0);
    const baseScore = totalAppearances * 1.5 + (101 - avgPeak) * 4 + candidateTracks.length * 3;

    candidates.push({
      candidateKey: buildCandidateKey(artist, title, year),
      title,
      artist,
      normalizedTitle: normalizeText(title),
      normalizedArtist: normalizeText(artist),
      releaseYear: year,
      albumType: normalizeText(album.album_type ?? "studio").includes("compilation") ? "compilation" : "studio",
      soundtrackFlag: normalizeText(album.soundtrack_flag ?? "false") === "true",
      eraSlug: eraSlugForYear(eras, year),
      decade: decadeForYear(year),
      tracks: candidateTracks,
      baseScore,
      sourceTag: "canonical_seed",
      notes: "Seeded from canonical import source.",
      genreBucket: resolveGenreBucket(title),
      isCulturalAnchor: isCulturalAnchorArtist(artist),
    });
  }
  return candidates;
}

function buildInferredCandidates(
  eras: EraRecord[],
  trackStatsByKey: Map<string, ChartTrackStats>,
  artistStatsByKey: Map<string, ArtistStats>,
): CandidateAlbum[] {
  const tracksByArtist = new Map<string, ChartTrackStats[]>();
  for (const track of trackStatsByKey.values()) {
    const current = tracksByArtist.get(track.normalizedArtist) ?? [];
    current.push(track);
    tracksByArtist.set(track.normalizedArtist, current);
  }

  const candidates: CandidateAlbum[] = [];
  const sortedArtists = [...artistStatsByKey.values()].sort((a, b) => b.score - a.score);
  for (const artistStats of sortedArtists) {
    const artistTracks = tracksByArtist.get(artistStats.normalizedArtist) ?? [];
    if (artistTracks.length < 2) continue;

    const scoredTracks = artistTracks
      .map((track) => ({ track, score: scoreTrack(track, artistStats) }))
      .sort((a, b) => b.score - a.score);

    const tracksByDecade = new Map<string, Array<{ track: ChartTrackStats; score: number }>>();
    for (const entry of scoredTracks) {
      const representativeYear = entry.track.years.size > 0 ? Math.min(...entry.track.years) : null;
      const decade = decadeForYear(representativeYear);
      const current = tracksByDecade.get(decade) ?? [];
      current.push(entry);
      tracksByDecade.set(decade, current);
    }

    const decadesByWeight = [...tracksByDecade.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [index, [decade, entries]] of decadesByWeight.slice(0, 3).entries()) {
      const topTracks = entries.slice(0, 12);
      if (topTracks.length < 2) continue;
      const anchorTrack = topTracks[0]?.track;
      const inferredYear =
        anchorTrack && anchorTrack.years.size > 0 ? Math.min(...anchorTrack.years) : parseInteger(decade.slice(0, 4)) ?? null;
      const candidateTitle =
        index === 0 ? `${artistStats.artist} Greatest Hits` : index === 1 ? `${artistStats.artist} Essentials` : `${artistStats.artist} Best Of`;
      const baseScore =
        topTracks.reduce((sum, entry) => sum + entry.score, 0) * 0.45 +
        artistStats.score * 2 +
        (isCulturalAnchorArtist(artistStats.artist) ? 120 : 0);

      candidates.push({
        candidateKey: buildCandidateKey(artistStats.artist, candidateTitle, inferredYear),
        title: candidateTitle,
        artist: artistStats.artist,
        normalizedTitle: normalizeText(candidateTitle),
        normalizedArtist: artistStats.normalizedArtist,
        releaseYear: inferredYear,
        albumType: "compilation",
        soundtrackFlag: false,
        eraSlug: eraSlugForYear(eras, inferredYear),
        decade,
        tracks: topTracks.map(({ track }) => ({
          title: track.title,
          artist: track.artist,
          normalizedTitle: track.normalizedTitle,
          normalizedArtist: track.normalizedArtist,
          bestPeak: track.bestPeak,
          maxWeeksOnChart: track.maxWeeksOnChart,
          representativeYear: track.years.size > 0 ? Math.min(...track.years) : inferredYear,
          appearances: track.appearances,
          sourceTrackKey: track.key,
        })),
        baseScore,
        sourceTag: "chart_inferred",
        notes: "Inferred acquisition-ready compilation from recurring chart tracks.",
        genreBucket: "compilation",
        isCulturalAnchor: isCulturalAnchorArtist(artistStats.artist),
      });
    }

    if (scoredTracks.length >= 8) {
      const topTracks = scoredTracks.slice(0, 14).map(({ track }) => track);
      const anchorTrack = topTracks[0];
      const inferredYear = anchorTrack && anchorTrack.years.size > 0 ? Math.min(...anchorTrack.years) : null;
      candidates.push({
        candidateKey: buildCandidateKey(artistStats.artist, `${artistStats.artist} Anthology`, inferredYear),
        title: `${artistStats.artist} Anthology`,
        artist: artistStats.artist,
        normalizedTitle: normalizeText(`${artistStats.artist} Greatest Chart Tracks`),
        normalizedArtist: artistStats.normalizedArtist,
        releaseYear: inferredYear,
        albumType: "compilation",
        soundtrackFlag: false,
        eraSlug: eraSlugForYear(eras, inferredYear),
        decade: decadeForYear(inferredYear),
        tracks: topTracks.map((track) => ({
          title: track.title,
          artist: track.artist,
          normalizedTitle: track.normalizedTitle,
          normalizedArtist: track.normalizedArtist,
          bestPeak: track.bestPeak,
          maxWeeksOnChart: track.maxWeeksOnChart,
          representativeYear: track.years.size > 0 ? Math.min(...track.years) : inferredYear,
          appearances: track.appearances,
          sourceTrackKey: track.key,
        })),
        baseScore: artistStats.score * 2.4 + 55,
        sourceTag: "chart_inferred",
        notes: "Inferred anthology-style compilation from chart recurrence.",
        genreBucket: "compilation",
        isCulturalAnchor: isCulturalAnchorArtist(artistStats.artist),
      });
    }
  }

  for (const anchor of CULTURAL_ANCHOR_ALBUMS) {
    const existing = candidates.some(
      (candidate) =>
        normalizeText(candidate.artist) === normalizeText(anchor.artist) &&
        normalizeText(candidate.title) === normalizeText(anchor.title),
    );
    if (existing) continue;
    const sourceTracks = [...trackStatsByKey.values()]
      .filter((track) => normalizeText(track.artist).includes(normalizeText(anchor.artist)))
      .sort((a, b) => b.appearances - a.appearances)
      .slice(0, 10)
      .map((track) => ({
        title: track.title,
        artist: track.artist,
        normalizedTitle: track.normalizedTitle,
        normalizedArtist: track.normalizedArtist,
        bestPeak: track.bestPeak,
        maxWeeksOnChart: track.maxWeeksOnChart,
        representativeYear: track.years.size > 0 ? Math.min(...track.years) : anchor.year,
        appearances: track.appearances,
        sourceTrackKey: track.key,
      }));
    if (sourceTracks.length === 0) continue;
    candidates.push({
      candidateKey: buildCandidateKey(anchor.artist, anchor.title, anchor.year),
      title: anchor.title,
      artist: anchor.artist,
      normalizedTitle: normalizeText(anchor.title),
      normalizedArtist: normalizeText(anchor.artist),
      releaseYear: anchor.year,
      albumType: anchor.albumType ?? "studio",
      soundtrackFlag: anchor.albumType === "soundtrack",
      eraSlug: eraSlugForYear(eras, anchor.year),
      decade: decadeForYear(anchor.year),
      tracks: sourceTracks,
      baseScore: 220,
      sourceTag: "chart_inferred",
      notes: "Forced cultural anchor for recognition coverage.",
      genreBucket: resolveGenreBucket(anchor.title),
      isCulturalAnchor: true,
    });
  }

  return candidates;
}

function dedupeCandidates(candidates: CandidateAlbum[]): CandidateAlbum[] {
  const byKey = new Map<string, CandidateAlbum>();
  for (const candidate of candidates) {
    const dedupeKey = `${candidate.normalizedArtist}::${candidate.normalizedTitle}`;
    const existing = byKey.get(dedupeKey);
    if (!existing || candidate.baseScore > existing.baseScore) byKey.set(dedupeKey, candidate);
  }
  return [...byKey.values()];
}

function proportionalTargets(map: Map<string, number>, targetTotal: number, floor = 8): Map<string, number> {
  const total = [...map.values()].reduce((sum, value) => sum + value, 0);
  const result = new Map<string, number>();
  if (total <= 0) return result;
  for (const [key, value] of map.entries()) {
    const ratio = value / total;
    result.set(key, Math.max(floor, Math.round(ratio * targetTotal)));
  }
  return result;
}

function selectBalancedCandidates(
  candidates: CandidateAlbum[],
  targetCount: number,
  chartRowsByDecade: Map<string, number>,
) {
  const sorted = [...candidates].sort((a, b) => b.baseScore - a.baseScore);
  const candidateByKey = new Map(sorted.map((candidate) => [candidate.candidateKey, candidate]));
  const selectedKeys = new Set<string>();

  const artistCounts = new Map<string, number>();
  const decadeCounts = new Map<string, number>();
  const eraCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();

  const decadeTargets = proportionalTargets(chartRowsByDecade, targetCount, 12);
  const eraSource = new Map<string, number>();
  for (const candidate of sorted) {
    const era = candidate.eraSlug ?? "unknown";
    eraSource.set(era, (eraSource.get(era) ?? 0) + 1);
  }
  const eraTargets = proportionalTargets(eraSource, targetCount, 12);

  function canSelect(candidate: CandidateAlbum, strict: boolean): boolean {
    const artistCount = artistCounts.get(candidate.normalizedArtist) ?? 0;
    if (artistCount >= MAX_ALBUMS_PER_ARTIST) return false;

    const decade = candidate.decade;
    const era = candidate.eraSlug ?? "unknown";
    const genre = candidate.genreBucket ?? "unknown";
    if (strict) {
      const decadeTarget = decadeTargets.get(decade) ?? Math.ceil(targetCount * 0.15);
      const eraTarget = eraTargets.get(era) ?? Math.ceil(targetCount * 0.2);
      if ((decadeCounts.get(decade) ?? 0) >= Math.ceil(decadeTarget * 1.2)) return false;
      if ((eraCounts.get(era) ?? 0) >= Math.ceil(eraTarget * 1.2)) return false;
      if ((genreCounts.get(genre) ?? 0) >= Math.ceil(targetCount * 0.6)) return false;
    }
    return true;
  }

  function commit(candidate: CandidateAlbum) {
    selectedKeys.add(candidate.candidateKey);
    artistCounts.set(candidate.normalizedArtist, (artistCounts.get(candidate.normalizedArtist) ?? 0) + 1);
    decadeCounts.set(candidate.decade, (decadeCounts.get(candidate.decade) ?? 0) + 1);
    const era = candidate.eraSlug ?? "unknown";
    eraCounts.set(era, (eraCounts.get(era) ?? 0) + 1);
    const genre = candidate.genreBucket ?? "unknown";
    genreCounts.set(genre, (genreCounts.get(genre) ?? 0) + 1);
  }

  // Pass 1: strict balancing.
  for (const candidate of sorted) {
    if (selectedKeys.size >= targetCount) break;
    if (canSelect(candidate, true)) commit(candidate);
  }
  // Pass 2: relax balancing, keep artist cap.
  for (const candidate of sorted) {
    if (selectedKeys.size >= targetCount) break;
    if (selectedKeys.has(candidate.candidateKey)) continue;
    if (canSelect(candidate, false)) commit(candidate);
  }

  const selected = [...selectedKeys].map((key) => candidateByKey.get(key)).filter((value): value is CandidateAlbum => Boolean(value));
  return { selected, artistCounts, decadeCounts, eraCounts, decadeTargets, eraTargets };
}

function enforceProbeInclusion(
  selection: CandidateAlbum[],
  candidates: CandidateAlbum[],
  targetCount: number,
): { albums: CandidateAlbum[]; probes: ProbeResult[] } {
  const selected = [...selection];
  const selectedSet = new Set(selected.map((album) => album.candidateKey));

  function probeMatches(probe: string, album: CandidateAlbum): boolean {
    return artistMatchesProbe(album.artist, probe);
  }

  for (const probe of REQUIRED_PROBE_ARTISTS) {
    const already = selected.some((album) => probeMatches(probe, album));
    if (already) continue;
    const bestProbeCandidate = [...candidates]
      .filter((album) => probeMatches(probe, album))
      .sort((a, b) => b.baseScore - a.baseScore)[0];
    if (!bestProbeCandidate) continue;
    if (!selectedSet.has(bestProbeCandidate.candidateKey)) {
      selected.push(bestProbeCandidate);
      selectedSet.add(bestProbeCandidate.candidateKey);
    }
  }

  selected.sort((a, b) => b.baseScore - a.baseScore);
  if (selected.length > targetCount) selected.length = targetCount;

  const probes: ProbeResult[] = REQUIRED_PROBE_ARTISTS.map((probe) => {
    const matched = selected.filter((album) => probeMatches(probe, album)).map((album) => album.artist);
    return {
      probe,
      included: matched.length > 0,
      matchedArtists: [...new Set(matched)],
    };
  });
  return { albums: selected, probes };
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(row.map((value) => csvEscape(value)).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function buildSourceKey(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  const key = `${base}-${index}`;
  used.add(key);
  return key;
}

function acquisitionLikelihood(
  album: CandidateAlbum,
): { band: "high" | "medium" | "low"; score: number; likelyItunesSearchQuery: string } {
  let score = 0;
  if (album.sourceTag === "canonical_seed") score += 4;
  if (album.releaseYear) score += 1;
  if (album.isCulturalAnchor) score += 2;
  if (album.baseScore >= 160) score += 1;
  if (album.baseScore >= 230) score += 1;

  const normalizedTitle = normalizeText(album.title);
  if (normalizedTitle.includes("greatest hits")) score += 2;
  if (normalizedTitle.includes("essentials")) score += 1;
  if (normalizedTitle.includes("best of")) score += 1;
  if (normalizedTitle.includes("anthology")) score += 1;
  if (album.albumType === "soundtrack") score += 1;
  if (album.albumType === "live") score -= 1;

  const band = score >= 7 ? "high" : score >= 4 ? "medium" : "low";
  const likelyItunesSearchQuery = [album.artist, album.title, album.releaseYear ? String(album.releaseYear) : ""]
    .filter(Boolean)
    .join(" ");
  return { band, score, likelyItunesSearchQuery };
}

function estimateAcquisitionAndRepair(albums: CandidateAlbum[]) {
  let high = 0;
  let medium = 0;
  let low = 0;
  let unresolved = 0;
  let repair = 0;
  for (const album of albums) {
    const likelihood = acquisitionLikelihood(album);
    if (likelihood.band === "high") high += 1;
    if (likelihood.band === "medium") medium += 1;
    if (likelihood.band === "low") low += 1;

    const title = normalizeText(album.title);
    const isAcquisitionFriendlyTitle =
      title.includes("greatest hits") || title.includes("essentials") || title.includes("best of") || title.includes("anthology");
    const isUnresolved =
      likelihood.band === "low" ||
      (likelihood.band === "medium" &&
        album.sourceTag === "chart_inferred" &&
        !album.isCulturalAnchor &&
        (!isAcquisitionFriendlyTitle || (album.releaseYear ?? 0) < 1965));
    if (isUnresolved) unresolved += 1;

    const needsRepair =
      isUnresolved ||
      (likelihood.band === "medium" &&
        album.sourceTag === "chart_inferred" &&
        !album.isCulturalAnchor &&
        (album.baseScore < 150 || !isAcquisitionFriendlyTitle));
    if (needsRepair) repair += 1;
  }
  return {
    itunesAcquisitionCandidateEstimate: high + medium,
    discoverRepairCandidateEstimate: repair,
    unresolvedEstimate: unresolved,
    highLikelihood: high,
    mediumLikelihood: medium,
    lowLikelihood: low,
  };
}

async function writeOutputs(albums: CandidateAlbum[]) {
  await mkdir(OUTPUT_ROOT, { recursive: true });
  const usedAlbumKeys = new Set<string>();
  const usedTrackKeys = new Set<string>();
  const usedChartKeys = new Set<string>();

  const albumsRows: string[][] = [];
  const tracksRows: string[][] = [];
  const artistsRows: string[][] = [];
  const chartRows: string[][] = [];
  const acquisitionPrepRows: string[][] = [];
  const artistAlbumCounts = new Map<string, number>();

  for (const album of albums) {
    const albumSourceBase = `album::${normalizeSlug(album.artist)}::${normalizeSlug(album.title)}::${album.releaseYear ?? "unknown"}`;
    const albumSourceKey = buildSourceKey(albumSourceBase, usedAlbumKeys);
    const editionKey = `primary-${album.releaseYear ?? "unknown"}-${normalizeSlug(album.title).slice(0, 28)}`;
    const releaseDate = album.releaseYear ? `${album.releaseYear}-01-01` : "";

    albumsRows.push([
      albumSourceKey,
      album.title,
      album.artist,
      album.releaseYear ? String(album.releaseYear) : "",
      album.albumType,
      album.soundtrackFlag ? "true" : "false",
      album.eraSlug ?? "",
      releaseDate,
      album.notes,
      album.title,
      album.artist,
      editionKey,
      "Primary canonical edition",
      releaseDate,
      album.releaseYear ? String(album.releaseYear) : "",
      "canonicalized",
    ]);
    const acquisition = acquisitionLikelihood(album);
    acquisitionPrepRows.push([
      acquisition.likelyItunesSearchQuery,
      normalizeNameToken(album.artist),
      normalizeNameToken(album.title),
      album.releaseYear ? String(album.releaseYear) : "",
      acquisition.band,
      String(acquisition.score),
      album.sourceTag,
      album.eraSlug ?? "",
      album.decade,
    ]);

    artistAlbumCounts.set(album.artist, (artistAlbumCounts.get(album.artist) ?? 0) + 1);

    album.tracks.forEach((track, index) => {
      const trackSourceBase = `track::${normalizeSlug(track.artist)}::${normalizeSlug(track.title)}::${normalizeSlug(album.title)}`;
      const trackSourceKey = buildSourceKey(trackSourceBase, usedTrackKeys);
      tracksRows.push([
        trackSourceKey,
        albumSourceKey,
        track.title,
        track.artist,
        track.representativeYear ? String(track.representativeYear) : album.releaseYear ? String(album.releaseYear) : "",
        "1",
        String(index + 1),
        "",
        "",
        "false",
        "false",
        `Generated for discover universe (${album.sourceTag}).`,
        track.title,
        track.artist,
        "canonicalized",
      ]);

      const chartSourceBase = `chart::${trackSourceKey}::${track.representativeYear ?? album.releaseYear ?? "unknown"}::${track.bestPeak}`;
      const chartSourceKey = buildSourceKey(chartSourceBase, usedChartKeys);
      chartRows.push([
        chartSourceKey,
        trackSourceKey,
        `${track.representativeYear ?? album.releaseYear ?? 1970}-01-01`,
        "Billboard Hot 100",
        String(track.bestPeak),
        String(track.maxWeeksOnChart),
        "verified",
      ]);
    });
  }

  const artistRowsSorted = [...artistAlbumCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  for (const [artist, albumCount] of artistRowsSorted) {
    const normalized = normalizeSlug(artist);
    artistsRows.push([
      `artist::${normalized}`,
      artist,
      String(albumCount),
      albumCount >= 2 ? "anchor" : "emerging",
      "Generated discover universe candidate artist row.",
    ]);
  }

  const writes = [
    writeFile(
      path.join(OUTPUT_ROOT, "albums.csv"),
      toCsv(
        [
          "source_key",
          "title",
          "album_artist",
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
        albumsRows,
      ),
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_ROOT, "tracks.csv"),
      toCsv(
        [
          "source_key",
          "album_source_key",
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
          "source_title",
          "source_artist",
          "provenance_level",
        ],
        tracksRows,
      ),
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_ROOT, "artists.csv"),
      toCsv(["source_key", "canonical_artist_name", "selected_album_count", "artist_tier", "notes"], artistsRows),
      "utf8",
    ),
    writeFile(
      path.join(OUTPUT_ROOT, "chart_appearances.csv"),
      toCsv(
        [
          "source_key",
          "track_source_key",
          "chart_date",
          "chart_name",
          "chart_position",
          "weeks_on_chart",
          "provenance_level",
        ],
        chartRows,
      ),
      "utf8",
    ),
  ];
  if (WRITE_ACQUISITION_PREP) {
    writes.push(
      writeFile(
        path.join(OUTPUT_ROOT, "acquisition_prep.csv"),
        toCsv(
          [
            "likely_itunes_search_query",
            "normalized_artist",
            "normalized_album",
            "release_year",
            "acquisition_likelihood",
            "acquisition_score",
            "source_tag",
            "era_slug",
            "decade",
          ],
          acquisitionPrepRows,
        ),
        "utf8",
      ),
    );
  }
  await Promise.all(writes);

  return {
    albumCount: albumsRows.length,
    trackCount: tracksRows.length,
    artistCount: artistsRows.length,
    chartCount: chartRows.length,
    acquisitionPrepCount: acquisitionPrepRows.length,
  };
}

function summarizeCounts(entries: CandidateAlbum[], keySelector: (entry: CandidateAlbum) => string): Array<[string, number]> {
  const map = new Map<string, number>();
  for (const entry of entries) {
    const key = keySelector(entry);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

async function main() {
  const eras = await loadEras();
  const { trackStatsByKey, artistStatsByKey, chartRowsByDecade } = await buildChartStats();
  const seedCandidates = await buildSeedCandidates(eras, trackStatsByKey);
  const inferredCandidates = buildInferredCandidates(eras, trackStatsByKey, artistStatsByKey);
  const allCandidates = dedupeCandidates([...seedCandidates, ...inferredCandidates]);

  const { selected } = selectBalancedCandidates(allCandidates, TARGET_ALBUMS, chartRowsByDecade);
  const probeChecked = enforceProbeInclusion(selected, allCandidates, TARGET_ALBUMS);
  const finalAlbums = probeChecked.albums;

  const outputCounts = await writeOutputs(finalAlbums);
  const acquisitionEstimates = estimateAcquisitionAndRepair(finalAlbums);

  const decadeSpread = summarizeCounts(finalAlbums, (album) => decadeForYear(album.releaseYear));
  const eraSpread = summarizeCounts(finalAlbums, (album) => album.eraSlug ?? "unknown");
  const topArtists = summarizeCounts(finalAlbums, (album) => album.artist).slice(0, 15);

  console.log("\nDiscover Candidate Generation Complete");
  console.log(`output_root: ${OUTPUT_ROOT}`);
  console.log(`total_albums: ${outputCounts.albumCount}`);
  console.log(`total_artists: ${outputCounts.artistCount}`);
  console.log(`total_tracks: ${outputCounts.trackCount}`);
  console.log(`total_chart_appearances: ${outputCounts.chartCount}`);
  if (WRITE_ACQUISITION_PREP) console.log(`acquisition_prep_rows: ${outputCounts.acquisitionPrepCount}`);

  console.log("\nDecade Spread");
  for (const [decade, count] of decadeSpread) {
    console.log(`${decade}: ${count}`);
  }

  console.log("\nEra Spread");
  for (const [era, count] of eraSpread) {
    console.log(`${era}: ${count}`);
  }

  console.log("\nAcquisition and Repair Estimates");
  console.log(`itunes_acquisition_candidate_estimate: ${acquisitionEstimates.itunesAcquisitionCandidateEstimate}`);
  console.log(`discover_repair_candidate_estimate: ${acquisitionEstimates.discoverRepairCandidateEstimate}`);
  console.log(`unresolved_estimate: ${acquisitionEstimates.unresolvedEstimate}`);
  console.log(`acquisition_likelihood_high: ${acquisitionEstimates.highLikelihood}`);
  console.log(`acquisition_likelihood_medium: ${acquisitionEstimates.mediumLikelihood}`);
  console.log(`acquisition_likelihood_low: ${acquisitionEstimates.lowLikelihood}`);

  console.log("\nTop Artists by Album Count");
  for (const [artist, count] of topArtists) {
    console.log(`${artist}: ${count}`);
  }

  console.log("\nProbe Verification");
  for (const probe of probeChecked.probes) {
    console.log(`${probe.probe}: ${probe.included ? `yes (${probe.matchedArtists.join("; ")})` : "no"}`);
  }
}

main().catch((error) => {
  console.error("discover_universe_generation_failed:", error);
  process.exitCode = 1;
});
