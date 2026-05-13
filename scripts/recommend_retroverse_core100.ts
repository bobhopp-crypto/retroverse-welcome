import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
  disc_number: number | null;
  track_number: number | null;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
};

type ChartRow = {
  retroverse_track_id: string;
  chart_position: number | null;
  weeks_on_chart: number | null;
};

type SourceMatchRow = {
  retroverse_entity_type: string;
  retroverse_entity_id: string;
  source_key: string;
};

type Candidate = {
  albumId: string;
  sourceKey: string | null;
  artist: string;
  title: string;
  year: number | null;
  decade: string;
  trackCount: number;
  chartedTrackCount: number;
  weeksOnChartSum: number;
  bestPeak: number | null;
  score: number;
  reasons: string[];
};

const PAGE_SIZE = 1_000;
const TARGET = Number.parseInt(process.env.RETROVERSE_CORE_TARGET ?? "100", 10);
const ARTIST_CAP = Number.parseInt(process.env.RETROVERSE_CORE_ARTIST_CAP ?? "2", 10);
const OUTPUT_ROOT =
  process.env.RETROVERSE_CORE_OUTPUT_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/generated/hero_packs/core100_recommendation_v1";

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
  "pink floyd",
  "journey",
  "supertramp",
];

const ANCHOR_TITLE_TOKENS = [
  "thriller",
  "purple rain",
  "hotel california",
  "rumours",
  "greatest hits",
  "the wall",
  "news of the world",
  "physical",
  "escape",
];

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function decadeOf(year: number | null): string {
  if (!year) return "unknown";
  return `${Math.floor(year / 10) * 10}s`;
}

function toCsv(headers: string[], rows: string[][]): string {
  const esc = (value: string) => (value.includes(",") || value.includes('"') || value.includes("\n") ? `"${value.replace(/"/g, '""')}"` : value);
  return `${[headers.join(","), ...rows.map((row) => row.map(esc).join(","))].join("\n")}\n`;
}

async function fetchAllRows<T>(
  client: RetroverseSupabase,
  table: string,
  selectColumns: string,
  orderColumn: string,
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from(table)
      .select(selectColumns)
      .order(orderColumn, { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function scoreCandidate(candidate: Candidate): Candidate {
  let score = 0;
  const reasons: string[] = [];
  if (candidate.year !== null && candidate.year >= 1970 && candidate.year <= 1989) {
    score += 30;
    reasons.push("70s_80s_anchor");
  }
  const longevity = Math.min(45, candidate.weeksOnChartSum);
  score += longevity;
  if (longevity >= 20) reasons.push("chart_longevity");
  if (candidate.bestPeak !== null) {
    if (candidate.bestPeak <= 10) {
      score += 18;
      reasons.push("top10_peak");
    } else if (candidate.bestPeak <= 40) {
      score += 10;
      reasons.push("top40_peak");
    }
  }
  const sequencingBoost = Math.min(24, candidate.trackCount * 2);
  score += sequencingBoost;
  if (candidate.trackCount >= 8) reasons.push("sequencing_dense");
  const artistNorm = normalize(candidate.artist);
  const titleNorm = normalize(candidate.title);
  if (PRIORITY_ARTISTS.some((token) => artistNorm.includes(token))) {
    score += 28;
    reasons.push("priority_artist");
  }
  if (ANCHOR_TITLE_TOKENS.some((token) => titleNorm.includes(token))) {
    score += 16;
    reasons.push("cultural_anchor_title");
  }
  const searchUtility = Math.min(10, candidate.chartedTrackCount * 2);
  score += searchUtility;
  if (searchUtility >= 6) reasons.push("search_useful_tracks");
  return { ...candidate, score, reasons };
}

function targetForDecade(decade: string): number {
  if (decade === "1970s") return 38;
  if (decade === "1980s") return 38;
  if (decade === "1960s") return 8;
  if (decade === "1990s") return 8;
  return 8;
}

function selectCore100(candidates: Candidate[]): Candidate[] {
  const selected: Candidate[] = [];
  const artistCounts = new Map<string, number>();
  const decadeCounts = new Map<string, number>();

  for (const candidate of candidates) {
    if (selected.length >= TARGET) break;
    if (candidate.trackCount < 2) continue;
    const artistKey = normalize(candidate.artist);
    if ((artistCounts.get(artistKey) ?? 0) >= ARTIST_CAP) continue;
    const decade = candidate.decade;
    if ((decadeCounts.get(decade) ?? 0) >= targetForDecade(decade)) continue;
    selected.push(candidate);
    artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
    decadeCounts.set(decade, (decadeCounts.get(decade) ?? 0) + 1);
  }

  if (selected.length < TARGET) {
    for (const candidate of candidates) {
      if (selected.length >= TARGET) break;
      if (selected.some((row) => row.albumId === candidate.albumId)) continue;
      const artistKey = normalize(candidate.artist);
      if ((artistCounts.get(artistKey) ?? 0) >= ARTIST_CAP + 1) continue;
      selected.push(candidate);
      artistCounts.set(artistKey, (artistCounts.get(artistKey) ?? 0) + 1);
    }
  }

  return selected.slice(0, TARGET);
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY first.");
  }

  const client: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [albums, artists, editions, albumTracks, tracks, charts, sourceMatches] = await Promise.all([
    fetchAllRows<AlbumRow>(
      client,
      "retroverse_albums",
      "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year",
      "retroverse_album_id",
    ),
    fetchAllRows<ArtistRow>(client, "retroverse_artists", "retroverse_artist_id, canonical_artist_name", "retroverse_artist_id"),
    fetchAllRows<EditionRow>(client, "retroverse_album_editions", "retroverse_album_edition_id, retroverse_album_id", "retroverse_album_edition_id"),
    fetchAllRows<AlbumTrackRow>(
      client,
      "retroverse_album_tracks",
      "retroverse_album_edition_id, retroverse_track_id, disc_number, track_number",
      "retroverse_album_track_id",
    ),
    fetchAllRows<TrackRow>(client, "retroverse_tracks", "retroverse_track_id, canonical_title, retroverse_artist_id", "retroverse_track_id"),
    fetchAllRows<ChartRow>(
      client,
      "retroverse_chart_appearances",
      "retroverse_track_id, chart_position, weeks_on_chart",
      "retroverse_chart_id",
    ),
    fetchAllRows<SourceMatchRow>(
      client,
      "retroverse_source_matches",
      "retroverse_entity_type, retroverse_entity_id, source_key",
      "retroverse_source_match_id",
    ),
  ]);

  const artistById = new Map(artists.map((row) => [row.retroverse_artist_id, row.canonical_artist_name]));
  const sourceKeyByAlbumId = new Map(
    sourceMatches
      .filter((row) => row.retroverse_entity_type === "album")
      .map((row) => [row.retroverse_entity_id, row.source_key]),
  );

  const editionToAlbum = new Map(editions.map((row) => [row.retroverse_album_edition_id, row.retroverse_album_id]));
  const trackIdsByAlbum = new Map<string, Set<string>>();
  for (const row of albumTracks) {
    const albumId = editionToAlbum.get(row.retroverse_album_edition_id);
    if (!albumId) continue;
    const current = trackIdsByAlbum.get(albumId) ?? new Set<string>();
    current.add(row.retroverse_track_id);
    trackIdsByAlbum.set(albumId, current);
  }

  const chartByTrack = new Map<string, ChartRow[]>();
  for (const chart of charts) {
    const current = chartByTrack.get(chart.retroverse_track_id) ?? [];
    current.push(chart);
    chartByTrack.set(chart.retroverse_track_id, current);
  }

  const candidates = albums.map((album): Candidate => {
    const trackIds = [...(trackIdsByAlbum.get(album.retroverse_album_id) ?? new Set<string>())];
    let weeksOnChartSum = 0;
    let chartedTrackCount = 0;
    let bestPeak: number | null = null;
    for (const trackId of trackIds) {
      const chartRows = chartByTrack.get(trackId) ?? [];
      if (chartRows.length > 0) chartedTrackCount += 1;
      for (const chartRow of chartRows) {
        weeksOnChartSum += chartRow.weeks_on_chart ?? 0;
        if (chartRow.chart_position !== null && chartRow.chart_position !== undefined) {
          bestPeak = bestPeak === null ? chartRow.chart_position : Math.min(bestPeak, chartRow.chart_position);
        }
      }
    }
    return scoreCandidate({
      albumId: album.retroverse_album_id,
      sourceKey: sourceKeyByAlbumId.get(album.retroverse_album_id) ?? null,
      artist: artistById.get(album.retroverse_artist_id) ?? "Unknown Artist",
      title: album.canonical_album_title,
      year: album.release_year,
      decade: decadeOf(album.release_year),
      trackCount: trackIds.length,
      chartedTrackCount,
      weeksOnChartSum,
      bestPeak,
      score: 0,
      reasons: [],
    });
  });

  candidates.sort((a, b) => b.score - a.score || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));
  const selected = selectCore100(candidates);

  const priorityPresent = new Set(
    selected
      .map((row) => normalize(row.artist))
      .filter((artist) => PRIORITY_ARTISTS.some((token) => artist.includes(token))),
  );
  const decadeCoverage = new Map<string, number>();
  for (const row of selected) decadeCoverage.set(row.decade, (decadeCoverage.get(row.decade) ?? 0) + 1);

  await mkdir(OUTPUT_ROOT, { recursive: true });
  await writeFile(
    path.join(OUTPUT_ROOT, "retroverse_core100_recommendation.csv"),
    toCsv(
      [
        "rank",
        "retroverse_album_id",
        "album_source_key",
        "canonical_album_artist",
        "canonical_album_title",
        "release_year",
        "decade",
        "track_count",
        "charted_track_count",
        "weeks_on_chart_sum",
        "best_peak",
        "score",
        "reasons",
      ],
      selected.map((row, idx) => [
        String(idx + 1),
        row.albumId,
        row.sourceKey ?? "",
        row.artist,
        row.title,
        row.year !== null ? String(row.year) : "",
        row.decade,
        String(row.trackCount),
        String(row.chartedTrackCount),
        String(row.weeksOnChartSum),
        row.bestPeak !== null ? String(row.bestPeak) : "",
        row.score.toFixed(2),
        row.reasons.join("|"),
      ]),
    ),
    "utf8",
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    outputRoot: OUTPUT_ROOT,
    target: TARGET,
    selected: selected.length,
    metrics: {
      averageScore: selected.length > 0 ? Number((selected.reduce((sum, row) => sum + row.score, 0) / selected.length).toFixed(2)) : 0,
      sequencingCompletenessPct:
        selected.length > 0 ? Number(((selected.filter((row) => row.trackCount >= 8).length / selected.length) * 100).toFixed(2)) : 0,
      decades: [...decadeCoverage.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      uniqueArtists: new Set(selected.map((row) => normalize(row.artist))).size,
      priorityArtistCoverage: {
        requested: PRIORITY_ARTISTS.length,
        present: PRIORITY_ARTISTS.filter((token) => [...priorityPresent].some((artist) => artist.includes(token))).length,
        missing: PRIORITY_ARTISTS.filter((token) => ![...priorityPresent].some((artist) => artist.includes(token))),
      },
    },
  };

  await writeFile(path.join(OUTPUT_ROOT, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");

  console.log("\nRetroverse Core 100 Recommendation Generated");
  console.log(`output_root: ${OUTPUT_ROOT}`);
  console.log(`selected: ${selected.length}`);
  console.log(`unique_artists: ${manifest.metrics.uniqueArtists}`);
  console.log(`sequencing_completeness_pct: ${manifest.metrics.sequencingCompletenessPct}`);
}

main().catch((error) => {
  console.error("recommend_retroverse_core100_failed:", error);
  process.exitCode = 1;
});
