import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type Candidate = {
  artist_name: string;
  collection_name: string;
  release_date: string | null;
  artwork_url_100: string | null;
  artwork_url_600: string | null;
  score: number;
  artist_score: number;
  title_score: number;
  year_score: number;
  penalties: string[];
  reasons: string[];
};

type AcquisitionRow = {
  album_id: string;
  artist: string;
  title: string;
  release_year: number | null;
  connected_track_count: number;
  charted_track_count: number;
  importance_score: number;
  tier: "high" | "medium" | "unresolved";
  best_candidate: Candidate | null;
  candidates: Candidate[];
  download_status: "downloaded" | "failed" | "not_attempted";
  staged_file: string | null;
  download_error: string | null;
};

type AcquisitionSummary = {
  run_id: string;
  outputs: {
    run_root: string;
  };
  rows: AcquisitionRow[];
};

type ReviewDecision = "approve" | "reject" | "defer";

type ReviewRow = {
  album_id: string;
  artist: string;
  title: string;
  release_year: number | null;
  confidence_score: number;
  artist_score: number;
  title_score: number;
  year_score: number;
  staged_file: string;
  staged_file_rel: string;
  source_artist: string;
  source_collection: string;
  source_release_date: string | null;
  source_artwork_url_600: string | null;
  reasons: string[];
  penalties: string[];
  decision: ReviewDecision;
  review_notes: string;
};

const ITUNES_PASS_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass";

function parseArgs(): { summaryPathArg: string | null } {
  const args = process.argv.slice(2);
  let summaryPathArg: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--summary" && args[i + 1]) {
      summaryPathArg = args[i + 1];
      i += 1;
    }
  }
  return { summaryPathArg };
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

async function latestSummaryPath(): Promise<string> {
  const entries = await readdir(ITUNES_PASS_ROOT, { withFileTypes: true });
  const runDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("itunes_canonical_pass_"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (runDirs.length === 0) throw new Error(`No iTunes pass directory found under ${ITUNES_PASS_ROOT}`);
  return path.join(ITUNES_PASS_ROOT, runDirs[0], "metadata", "itunes_acquisition_summary.json");
}

async function main() {
  const { summaryPathArg } = parseArgs();
  const summaryPath = summaryPathArg ?? (await latestSummaryPath());
  const raw = await readFile(summaryPath, "utf8");
  const summary = JSON.parse(raw) as AcquisitionSummary;

  const highRows = summary.rows.filter((row) => row.tier === "high" && row.download_status === "downloaded" && row.staged_file);
  const reviewRows: ReviewRow[] = highRows.map((row) => ({
    album_id: row.album_id,
    artist: row.artist,
    title: row.title,
    release_year: row.release_year,
    confidence_score: row.best_candidate?.score ?? 0,
    artist_score: row.best_candidate?.artist_score ?? 0,
    title_score: row.best_candidate?.title_score ?? 0,
    year_score: row.best_candidate?.year_score ?? 0,
    staged_file: row.staged_file ?? "",
    staged_file_rel: path.relative(summary.outputs.run_root, row.staged_file ?? ""),
    source_artist: row.best_candidate?.artist_name ?? "",
    source_collection: row.best_candidate?.collection_name ?? "",
    source_release_date: row.best_candidate?.release_date ?? null,
    source_artwork_url_600: row.best_candidate?.artwork_url_600 ?? null,
    reasons: row.best_candidate?.reasons ?? [],
    penalties: row.best_candidate?.penalties ?? [],
    decision: "approve",
    review_notes: "",
  }));

  const reviewDir = path.join(summary.outputs.run_root, "review");
  await mkdir(reviewDir, { recursive: true });
  const reviewJsonPath = path.join(reviewDir, "high_confidence_review.json");
  const reviewCsvPath = path.join(reviewDir, "high_confidence_review.csv");
  const contactSheetPath = path.join(reviewDir, "high_confidence_contact_sheet.html");
  const mdPath = path.join(reviewDir, "high_confidence_review.md");

  await writeFile(
    reviewJsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        run_id: summary.run_id,
        source_summary: summaryPath,
        total_high_downloaded: reviewRows.length,
        decisions: reviewRows,
      },
      null,
      2,
    ),
    "utf8",
  );

  const csvHeader = [
    "album_id",
    "artist",
    "title",
    "release_year",
    "confidence_score",
    "artist_score",
    "title_score",
    "year_score",
    "decision",
    "review_notes",
    "source_artist",
    "source_collection",
    "source_release_date",
    "staged_file",
  ].join(",");
  const csvBody = reviewRows
    .map((row) =>
      [
        csvEscape(row.album_id),
        csvEscape(row.artist),
        csvEscape(row.title),
        csvEscape(String(row.release_year ?? "")),
        String(row.confidence_score),
        String(row.artist_score),
        String(row.title_score),
        String(row.year_score),
        csvEscape(row.decision),
        csvEscape(row.review_notes),
        csvEscape(row.source_artist),
        csvEscape(row.source_collection),
        csvEscape(row.source_release_date ?? ""),
        csvEscape(row.staged_file),
      ].join(","),
    )
    .join("\n");
  await writeFile(reviewCsvPath, `${csvHeader}\n${csvBody}\n`, "utf8");

  const md = [
    `# High-Confidence iTunes Review (${summary.run_id})`,
    "",
    `- candidates: ${reviewRows.length}`,
    `- source summary: ${summaryPath}`,
    "",
    "Decision options: `approve`, `reject`, `defer`",
    "",
    "## Rows",
    "| Cover | Album ID | Artist | Title | Year | Confidence | Candidate Source | Decision | Notes |",
    "|---|---|---|---|---:|---:|---|---|---|",
    ...reviewRows.map((row) => {
      const src = row.staged_file.startsWith("/") ? `file://${row.staged_file}` : row.staged_file;
      return `| <img src="${src}" width="90" /> | ${row.album_id} | ${row.artist} | ${row.title} | ${row.release_year ?? ""} | ${row.confidence_score} | ${row.source_artist} - ${row.source_collection} | ${row.decision} | ${row.review_notes} |`;
    }),
    "",
  ].join("\n");
  await writeFile(mdPath, md, "utf8");

  const cards = reviewRows
    .map((row) => {
      const src = row.staged_file.startsWith("/") ? `file://${row.staged_file}` : row.staged_file;
      const release = row.release_year ?? "n/a";
      return `
<article class="card">
  <img src="${src}" alt="${row.title} cover" />
  <div class="meta">
    <h3>${row.artist} - ${row.title}</h3>
    <p><strong>${row.album_id}</strong> (${release})</p>
    <p>confidence: ${row.confidence_score} | artist:${row.artist_score} title:${row.title_score} year:${row.year_score}</p>
    <p>source: ${row.source_artist} - ${row.source_collection}</p>
    <p>decision: <strong>${row.decision}</strong></p>
    <p class="small">${row.staged_file_rel}</p>
  </div>
</article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>High Confidence Contact Sheet ${summary.run_id}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 20px; background: #f6f2e8; color: #23201b; }
    h1 { margin: 0 0 8px; }
    p { margin: 0 0 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
    .card { background: #fff9ee; border: 1px solid #c9bea6; border-radius: 8px; overflow: hidden; }
    .card img { width: 100%; height: 280px; object-fit: cover; background: #ddd; }
    .meta { padding: 10px 12px; font-size: 12px; line-height: 1.35; }
    .meta h3 { margin: 0 0 6px; font-size: 14px; }
    .meta p { margin: 3px 0; }
    .small { color: #6c6356; font-size: 11px; }
  </style>
</head>
<body>
  <h1>High-Confidence Contact Sheet</h1>
  <p>Run: ${summary.run_id} | candidates: ${reviewRows.length} | default decision: approve</p>
  <section class="grid">${cards}</section>
</body>
</html>`;
  await writeFile(contactSheetPath, html, "utf8");

  console.log(`high_review_json=${reviewJsonPath}`);
  console.log(`high_review_csv=${reviewCsvPath}`);
  console.log(`high_review_md=${mdPath}`);
  console.log(`high_contact_sheet_html=${contactSheetPath}`);
  console.log(`high_candidates=${reviewRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
