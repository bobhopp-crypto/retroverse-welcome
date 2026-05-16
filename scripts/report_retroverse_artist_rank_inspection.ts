/**
 * CSV inspection exports for yearly artist rankings.
 *
 * Run after: npm run generate:artist-year-rankings
 * Run: npm run report:artist-rank-inspection
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ArtistYearPresence } from "../lib/artist-year-ranking-schema";
import { getArtistYearRankingsBundle } from "../lib/load-artist-year-rankings";

const WORKSPACE = process.cwd();
const OUT_DIR = path.join(WORKSPACE, "reports", "retroverse-artist-rank");
const BY_YEAR_DIR = path.join(OUT_DIR, "by_year");
const TOP_REPORT = 100;

function csvEscapeCell(v: unknown): string {
  if (v == null || v === undefined) return "";
  const s = String(v);
  if (/[\r\n",]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.map(csvEscapeCell).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvEscapeCell(r[h])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function rowToCsv(p: ArtistYearPresence): Record<string, unknown> {
  return {
    year: p.year,
    retroverse_artist_rank: p.retroverse_artist_rank,
    artist_retroscope_key: p.artist_retroscope_key,
    artist_id: p.artist_id,
    artist_name: p.artist_name,
    peak_momentum_score: p.peak_momentum_score,
    album_component: p.score_breakdown.album_component,
    track_component: p.score_breakdown.track_component,
    weeks_component: p.score_breakdown.weeks_component,
    concurrency_multiplier: p.score_breakdown.concurrency_multiplier,
    retroscope_presence_bonus: p.score_breakdown.retroscope_presence_bonus,
    total_album_presence: p.total_album_presence,
    total_track_presence: p.total_track_presence,
    total_chart_weeks: p.total_chart_weeks,
    best_album_rank: p.best_album_rank ?? "",
    best_track_rank: p.best_track_rank ?? "",
    dominant_album_ids: p.dominant_album_ids.join("|"),
    dominant_track_ids: p.dominant_track_ids.join("|"),
  };
}

const CSV_HEADERS = [
  "year",
  "retroverse_artist_rank",
  "artist_retroscope_key",
  "artist_id",
  "artist_name",
  "peak_momentum_score",
  "album_component",
  "track_component",
  "weeks_component",
  "concurrency_multiplier",
  "retroscope_presence_bonus",
  "total_album_presence",
  "total_track_presence",
  "total_chart_weeks",
  "best_album_rank",
  "best_track_rank",
  "dominant_album_ids",
  "dominant_track_ids",
];

async function main() {
  const bundle = getArtistYearRankingsBundle();
  if (!bundle) {
    throw new Error(
      "Missing public/data/artists/retroverse-artist-year-rankings.json — run npm run generate:artist-year-rankings first",
    );
  }

  await mkdir(BY_YEAR_DIR, { recursive: true });

  const inventoryRows: Record<string, unknown>[] = [];
  const allRows: Record<string, unknown>[] = [];

  for (const year of bundle.years) {
    const ranked = (bundle.by_year[String(year)] ?? []).slice(0, TOP_REPORT);
    const yearCsvRows = ranked.map(rowToCsv);
    allRows.push(...yearCsvRows);

    await writeFile(
      path.join(BY_YEAR_DIR, `${year}_top_artists.csv`),
      toCsv(CSV_HEADERS, yearCsvRows),
      "utf8",
    );

    const top = ranked[0];
    inventoryRows.push({
      year,
      artist_slots: ranked.length,
      rank_1_artist: top?.artist_name ?? "",
      rank_1_artist_id: top?.artist_id ?? "",
      rank_1_score: top?.peak_momentum_score ?? "",
      rank_1_best_album_rank: top?.best_album_rank ?? "",
      rank_1_album_presence: top?.total_album_presence ?? "",
    });
  }

  await writeFile(path.join(OUT_DIR, "retroverse_artist_year_inventory.csv"), toCsv(
    [
      "year",
      "artist_slots",
      "rank_1_artist",
      "rank_1_artist_id",
      "rank_1_score",
      "rank_1_best_album_rank",
      "rank_1_album_presence",
    ],
    inventoryRows,
  ), "utf8");

  await writeFile(
    path.join(OUT_DIR, "retroverse_all_artist_rankings.csv"),
    toCsv(CSV_HEADERS, allRows),
    "utf8",
  );

  const md = [
    "# Retroverse artist year rankings",
    "",
    `Generated artifact: \`public/data/artists/retroverse-artist-year-rankings.json\``,
    `Source: ${bundle.source}`,
    `Years: ${bundle.years.length} (${bundle.years[0]}–${bundle.years[bundle.years.length - 1]})`,
    "",
    "## Checkpoint years",
    "",
  ];

  for (const y of [1972, 1977, 1984]) {
    const rows = bundle.by_year[String(y)] ?? [];
    md.push(`### ${y}`, "");
    md.push("| Rank | Artist | Score | Best album peak | Albums |", "");
    md.push("| --- | --- | ---: | ---: | ---: |", "");
    for (const r of rows.slice(0, 15)) {
      md.push(
        `| ${r.retroverse_artist_rank} | ${r.artist_name} | ${r.peak_momentum_score} | ${r.best_album_rank ?? "—"} | ${r.total_album_presence} |`,
      );
    }
    md.push("");
  }

  md.push("## Files", "");
  md.push("- `retroverse_artist_year_inventory.csv`");
  md.push("- `retroverse_all_artist_rankings.csv`");
  md.push("- `by_year/<YEAR>_top_artists.csv` (top 100 per year)");
  md.push("");

  await writeFile(path.join(OUT_DIR, "README.md"), md.join("\n"), "utf8");

  process.stderr.write(`[artist-rank-inspection] Wrote ${OUT_DIR}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
