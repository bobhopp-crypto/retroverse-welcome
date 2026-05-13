import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

type IntakeRow = {
  rank: number;
  album_id: string;
  artist: string;
  title: string;
  staging_filename: string;
  canonical_target_path: string;
};

type IntakeBatchFile = {
  batch_label: string;
  generated_at: string;
  source_queue_path: string;
  target_count: number;
  staging_dir: string;
  exports: IntakeRow[];
};

type ValidationRow = {
  album_id: string;
  title: string;
  artist: string;
  expected_filename: string;
  found_file: string | null;
  file_size_bytes: number | null;
  canonical_target_path: string;
  status: "ready" | "missing";
};

function parseArgs() {
  const rawArgs = process.argv.slice(2);
  let batchPath: string | null = null;

  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--batch" && rawArgs[i + 1]) {
      batchPath = rawArgs[i + 1];
      i += 1;
    }
  }

  if (!batchPath) {
    throw new Error("Provide --batch <batch_root_path> produced by export_artwork_intake_batch.ts");
  }
  return { batchPath };
}

async function sha1(absPath: string): Promise<string> {
  const content = await readFile(absPath);
  return createHash("sha1").update(content).digest("hex");
}

async function main() {
  const { batchPath } = parseArgs();
  const batchRoot = path.resolve(batchPath);
  const exportsDir = path.join(batchRoot, "exports");
  const stagingDir = path.join(batchRoot, "staging");
  const intakeJson = path.join(exportsDir, "artwork_intake_targets.json");

  const intakeRaw = await readFile(intakeJson, "utf8");
  const intake = JSON.parse(intakeRaw) as IntakeBatchFile;
  const stagedEntries = await readdir(stagingDir, { withFileTypes: true });
  const stagedFiles = stagedEntries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const validationRows: ValidationRow[] = [];
  const usedFiles = new Set<string>();

  for (const row of intake.exports) {
    const expected = row.staging_filename;
    let found = stagedFiles.find((name) => name === expected) ?? null;
    if (!found) {
      // Secondary tolerant match by album prefix.
      found = stagedFiles.find((name) => name.startsWith(`${row.album_id}__`)) ?? null;
    }

    if (found) usedFiles.add(found);

    const foundAbsPath = found ? path.join(stagingDir, found) : null;
    const size = foundAbsPath ? (await stat(foundAbsPath)).size : null;
    validationRows.push({
      album_id: row.album_id,
      title: row.title,
      artist: row.artist,
      expected_filename: expected,
      found_file: found,
      file_size_bytes: size,
      canonical_target_path: row.canonical_target_path,
      status: found ? "ready" : "missing",
    });
  }

  const untrackedStagingFiles = stagedFiles.filter((file) => !usedFiles.has(file));
  const hashGroups = new Map<string, string[]>();
  for (const file of stagedFiles) {
    const fullPath = path.join(stagingDir, file);
    const digest = await sha1(fullPath);
    hashGroups.set(digest, [...(hashGroups.get(digest) ?? []), file]);
  }
  const duplicateGroups = [...hashGroups.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([hash, files]) => ({ hash, files }));

  const readyCount = validationRows.filter((row) => row.status === "ready").length;
  const missingCount = validationRows.length - readyCount;

  const reportDir = path.join(batchRoot, "validation");
  await mkdir(reportDir, { recursive: true });
  const reportJsonPath = path.join(reportDir, "artwork_intake_validation.json");
  const reportMdPath = path.join(reportDir, "artwork_intake_validation.md");
  const applyCandidatesPath = path.join(reportDir, "artwork_apply_candidates.json");

  const applyCandidates = validationRows
    .filter((row) => row.status === "ready" && row.found_file)
    .map((row) => ({
      album_id: row.album_id,
      source_file: path.join(stagingDir, row.found_file ?? ""),
      target_relative_path: row.canonical_target_path.replace(/^public\//, ""),
      canonical_cover_path: row.canonical_target_path,
    }));

  await writeFile(
    reportJsonPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        batch_root: batchRoot,
        intake_source: intakeJson,
        totals: {
          targets: validationRows.length,
          ready: readyCount,
          missing: missingCount,
          untracked_staging_files: untrackedStagingFiles.length,
          duplicate_groups: duplicateGroups.length,
        },
        rows: validationRows,
        untracked_staging_files: untrackedStagingFiles,
        duplicate_groups: duplicateGroups,
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    applyCandidatesPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        batch_root: batchRoot,
        ready_count: applyCandidates.length,
        candidates: applyCandidates,
      },
      null,
      2,
    ),
    "utf8",
  );

  const md = [
    "# Artwork Intake Validation",
    "",
    `- targets: ${validationRows.length}`,
    `- ready: ${readyCount}`,
    `- missing: ${missingCount}`,
    `- untracked staging files: ${untrackedStagingFiles.length}`,
    `- duplicate hash groups: ${duplicateGroups.length}`,
    "",
    "## Ready rows (top 15)",
    ...validationRows
      .filter((row) => row.status === "ready")
      .slice(0, 15)
      .map((row) => `- ${row.album_id} | ${row.artist} - ${row.title} -> ${row.found_file}`),
    "",
    "## Missing rows (top 15)",
    ...validationRows
      .filter((row) => row.status === "missing")
      .slice(0, 15)
      .map((row) => `- ${row.album_id} | ${row.artist} - ${row.title}`),
    "",
  ].join("\n");
  await writeFile(reportMdPath, md, "utf8");

  console.log(`artwork_validation_json=${reportJsonPath}`);
  console.log(`artwork_validation_md=${reportMdPath}`);
  console.log(`artwork_apply_candidates=${applyCandidatesPath}`);
  console.log(`ready=${readyCount}`);
  console.log(`missing=${missingCount}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
