import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type ArtworkQueueItem = {
  album_id: string;
  title: string;
  artist: string;
  release_year: number | null;
  canonical_artwork_status: "missing" | "broken";
  fallback_thumb_available: boolean;
  connected_track_count: number;
  charted_track_count: number;
  artist_membership_count: number;
  enrichment_priority_score: number;
  suggested_target_path: string;
};

type EnrichmentQueueFile = {
  generated_at: string;
  artwork_enrichment?: {
    quick_win_targets?: ArtworkQueueItem[];
  };
};

const DEFAULT_ENRICHMENT_LOG_ROOT =
  process.env.RETROVERSE_ENRICHMENT_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/archive-enrichment";
const DEFAULT_INTAKE_ROOT =
  process.env.RETROVERSE_ARTWORK_INTAKE_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/artwork-intake";

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  let batchSize = 25;
  let queuePathArg: string | null = null;
  let batchLabelArg: string | null = null;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--batch-size" && rawArgs[i + 1]) {
      batchSize = Number.parseInt(rawArgs[i + 1], 10);
      i += 1;
    } else if (arg === "--queue" && rawArgs[i + 1]) {
      queuePathArg = rawArgs[i + 1];
      i += 1;
    } else if (arg === "--label" && rawArgs[i + 1]) {
      batchLabelArg = rawArgs[i + 1];
      i += 1;
    }
  }

  if (!Number.isFinite(batchSize) || batchSize <= 0) {
    throw new Error("Invalid --batch-size value. Use a positive integer.");
  }

  return { batchSize, queuePathArg, batchLabelArg };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function csvEscape(input: string): string {
  const value = input.replace(/"/g, "\"\"");
  return `"${value}"`;
}

function normalizeTimestampLabel(iso: string): string {
  return iso.replace(/[:.]/g, "-");
}

function classifyVisibility(item: ArtworkQueueItem): "tier_a" | "tier_b" | "tier_c" {
  if (item.enrichment_priority_score >= 20 || item.charted_track_count >= 3 || item.connected_track_count >= 8) {
    return "tier_a";
  }
  if (item.enrichment_priority_score >= 12 || item.charted_track_count >= 1 || item.connected_track_count >= 3) {
    return "tier_b";
  }
  return "tier_c";
}

async function latestQueuePath(logRoot: string): Promise<string> {
  const entries = await readdir(logRoot, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith("archive_enrichment_") && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (files.length === 0) {
    throw new Error(`No archive enrichment logs found under ${logRoot}`);
  }
  return path.join(logRoot, files[0]);
}

async function main() {
  const { batchSize, queuePathArg, batchLabelArg } = parseArgs();

  const queuePath = queuePathArg ?? (await latestQueuePath(DEFAULT_ENRICHMENT_LOG_ROOT));
  const queueRaw = await readFile(queuePath, "utf8");
  const queue = JSON.parse(queueRaw) as EnrichmentQueueFile;

  const quickWins = queue.artwork_enrichment?.quick_win_targets ?? [];
  if (quickWins.length === 0) {
    throw new Error(`No artwork quick-win targets found in ${queuePath}`);
  }

  const batchItems = quickWins.slice(0, batchSize);
  const batchLabel = batchLabelArg ?? normalizeTimestampLabel(new Date().toISOString());
  const batchRoot = path.join(DEFAULT_INTAKE_ROOT, "batches", `batch_${batchLabel}`);
  const stagingDir = path.join(batchRoot, "staging");
  const exportsDir = path.join(batchRoot, "exports");

  await mkdir(stagingDir, { recursive: true });
  await mkdir(exportsDir, { recursive: true });

  const exportRows = batchItems.map((item, idx) => {
    const titleSlug = slugify(item.title);
    const artistSlug = slugify(item.artist);
    const intakeFilename = `${item.album_id}__${artistSlug}__${titleSlug}.jpg`;
    const visibilityTier = classifyVisibility(item);
    return {
      rank: idx + 1,
      album_id: item.album_id,
      title: item.title,
      artist: item.artist,
      release_year: item.release_year,
      queue_status: item.canonical_artwork_status,
      score: item.enrichment_priority_score,
      charted_track_count: item.charted_track_count,
      connected_track_count: item.connected_track_count,
      fallback_thumb_available: item.fallback_thumb_available,
      visibility_tier: visibilityTier,
      staging_filename: intakeFilename,
      canonical_target_path: `public/retroverse/covers/${item.album_id}/${intakeFilename}`,
      search_hint: `${item.artist} ${item.title} album cover ${item.release_year ?? ""}`.trim(),
    };
  });

  const jsonPath = path.join(exportsDir, "artwork_intake_targets.json");
  const csvPath = path.join(exportsDir, "artwork_intake_targets.csv");
  const mdPath = path.join(exportsDir, "README.md");

  await writeFile(
    jsonPath,
    JSON.stringify(
      {
        batch_label: batchLabel,
        generated_at: new Date().toISOString(),
        source_queue_path: queuePath,
        target_count: exportRows.length,
        staging_dir: stagingDir,
        exports: exportRows,
      },
      null,
      2,
    ),
    "utf8",
  );

  const csvHeader = [
    "rank",
    "album_id",
    "artist",
    "title",
    "release_year",
    "queue_status",
    "score",
    "charted_track_count",
    "connected_track_count",
    "fallback_thumb_available",
    "visibility_tier",
    "staging_filename",
    "canonical_target_path",
    "search_hint",
  ].join(",");
  const csvBody = exportRows
    .map((row) =>
      [
        String(row.rank),
        csvEscape(row.album_id),
        csvEscape(row.artist),
        csvEscape(row.title),
        csvEscape(String(row.release_year ?? "")),
        csvEscape(row.queue_status),
        String(row.score),
        String(row.charted_track_count),
        String(row.connected_track_count),
        String(row.fallback_thumb_available),
        csvEscape(row.visibility_tier),
        csvEscape(row.staging_filename),
        csvEscape(row.canonical_target_path),
        csvEscape(row.search_hint),
      ].join(","),
    )
    .join("\n");
  await writeFile(csvPath, `${csvHeader}\n${csvBody}\n`, "utf8");

  const md = [
    "# Artwork Intake Batch",
    "",
    `- batch label: ${batchLabel}`,
    `- source queue: ${queuePath}`,
    `- target count: ${exportRows.length}`,
    `- staging folder: ${stagingDir}`,
    "",
    "## Curator flow",
    "",
    "1. Acquire covers manually into `staging/` using the provided `staging_filename`.",
    "2. Prefer front cover, high legibility, no collage unless canonical release uses it.",
    "3. Run `npm run artwork:intake:validate -- --batch <batch_path>` before assignment.",
    "",
    "## Priority cue",
    "",
    "- `tier_a`: highest visibility / strongest traversal impact.",
    "- `tier_b`: good impact, next pass.",
    "- `tier_c`: long tail cleanup.",
    "",
  ].join("\n");
  await writeFile(mdPath, md, "utf8");

  console.log(`artwork_intake_batch=${batchRoot}`);
  console.log(`artwork_intake_json=${jsonPath}`);
  console.log(`artwork_intake_csv=${csvPath}`);
  console.log(`artwork_intake_readme=${mdPath}`);
  console.log(`staging_dir=${stagingDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
