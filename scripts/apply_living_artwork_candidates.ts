import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";
import {
  loadArtworkStateRegistry,
  saveArtworkStateRegistry,
  upsertArtworkState,
} from "../lib/artwork-living-archive";
import {
  ARTWORK_DEPLOY_ROOT,
  ARTWORK_ITUNES_PASS_ROOT,
  ARTWORK_MASTER_ROOT,
  deployedCanonicalPath,
  masterCoverPath,
} from "../lib/artwork-storage-model";

type Candidate = {
  artist_name: string;
  collection_name: string;
  release_date: string | null;
  artwork_url_600: string | null;
  score: number;
};

type AcquisitionRow = {
  album_id: string;
  artist: string;
  title: string;
  release_year: number | null;
  tier: "high" | "medium" | "unresolved";
  best_candidate: Candidate | null;
  download_status: "downloaded" | "failed" | "not_attempted";
  staged_file: string | null;
  query_used_for_best?: string | null;
  normalized_query?: string | null;
};

type AcquisitionSummary = {
  run_id: string;
  outputs: { run_root: string };
  rows: AcquisitionRow[];
};

type ArtworkRow = {
  retroverse_album_artwork_id: string;
  retroverse_album_id: string;
  canonical_cover_path: string | null;
  is_primary?: boolean;
  artwork_role?: string | null;
  artwork_status?: string | null;
};

const ITUNES_PASS_ROOT = ARTWORK_ITUNES_PASS_ROOT;
const LOG_ROOT = "/Users/bobhopp/RETROVERSE_DATA/logs/artwork-living-archive";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function latestDir(prefix: string): Promise<string | null> {
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(ITUNES_PASS_ROOT, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  return names[0] ? path.join(ITUNES_PASS_ROOT, names[0]) : null;
}

async function nextArtworkId(
  supabase: RetroverseSupabase,
): Promise<string> {
  const { data, error } = await supabase.from("retroverse_album_artwork").select("retroverse_album_artwork_id");
  if (error) throw error;
  const next =
    Math.max(
      0,
      ...(data ?? []).map((row) => {
        const m = String(row.retroverse_album_artwork_id).match(/^RVAW(\d+)$/);
        return m ? Number.parseInt(m[1], 10) : 0;
      }),
    ) + 1;
  return `RVAW${String(next).padStart(6, "0")}`;
}

function pickBetterRow(a: { row: AcquisitionRow; runId: string }, b: { row: AcquisitionRow; runId: string }) {
  const sa = a.row.best_candidate?.score ?? 0;
  const sb = b.row.best_candidate?.score ?? 0;
  if (sb !== sa) return sb > sa ? b : a;
  return b.runId.localeCompare(a.runId) > 0 ? b : a;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before living apply.");
  }
  const supabase: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [acquisitionDir, refinementDir] = await Promise.all([
    latestDir("itunes_canonical_pass_"),
    latestDir("itunes_unresolved_refine_"),
  ]);
  const [acquisitionSummary, refinementSummary] = await Promise.all([
    acquisitionDir
      ? readJson<AcquisitionSummary>(path.join(acquisitionDir, "metadata", "itunes_acquisition_summary.json"))
      : Promise.resolve(null),
    refinementDir
      ? readJson<AcquisitionSummary>(path.join(refinementDir, "metadata", "unresolved_refinement_summary.json"))
      : Promise.resolve(null),
  ]);
  if (!acquisitionSummary && !refinementSummary) {
    throw new Error("No acquisition/refinement summaries found.");
  }

  const runId = `living_artwork_apply_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const logDir = path.join(LOG_ROOT, runId);
  await mkdir(logDir, { recursive: true });

  const { data: beforeRows, error: beforeErr } = await supabase
    .from("retroverse_album_artwork")
    .select("retroverse_album_artwork_id, retroverse_album_id, canonical_cover_path, is_primary, artwork_role, artwork_status, cover_source, notes, created_at");
  if (beforeErr) throw beforeErr;
  const beforeSnapshotPath = path.join(logDir, "pre_apply_snapshot.json");
  await writeFile(
    beforeSnapshotPath,
    JSON.stringify({ generated_at: new Date().toISOString(), rows: beforeRows ?? [] }, null, 2),
    "utf8",
  );

  const existingByAlbum = new Map<string, ArtworkRow[]>();
  for (const row of (beforeRows ?? []) as ArtworkRow[]) {
    existingByAlbum.set(row.retroverse_album_id, [...(existingByAlbum.get(row.retroverse_album_id) ?? []), row]);
  }

  const pickedByAlbum = new Map<string, { row: AcquisitionRow; runId: string }>();
  for (const summary of [acquisitionSummary, refinementSummary].filter(Boolean) as AcquisitionSummary[]) {
    for (const row of summary.rows) {
      if (!row.staged_file || row.download_status !== "downloaded") continue;
      if (row.tier !== "high" && row.tier !== "medium") continue;
      const existing = pickedByAlbum.get(row.album_id);
      if (!existing) {
        pickedByAlbum.set(row.album_id, { row, runId: summary.run_id });
      } else {
        pickedByAlbum.set(row.album_id, pickBetterRow(existing, { row, runId: summary.run_id }));
      }
    }
  }

  const registry = await loadArtworkStateRegistry();
  const appliedHigh: string[] = [];
  const appliedMediumNeedsReview: string[] = [];
  const skipped: Array<{ album_id: string; reason: string }> = [];

  for (const { row, runId: sourceRunId } of pickedByAlbum.values()) {
    const existing = existingByAlbum.get(row.album_id) ?? [];
    const primary = existing.find((item) => item.is_primary) ?? existing.find((item) => item.artwork_role === "primary") ?? existing[0] ?? null;
    if (primary?.canonical_cover_path) {
      skipped.push({ album_id: row.album_id, reason: "already_has_canonical_cover" });
      continue;
    }
    if (!row.staged_file) {
      skipped.push({ album_id: row.album_id, reason: "missing_staged_file" });
      continue;
    }

    const extension = path.extname(row.staged_file) || ".jpg";
    const filename = `${row.album_id}__${slugify(row.artist)}__${slugify(row.title)}${extension}`;
    const masterAbs = masterCoverPath(row.album_id, filename);
    await mkdir(path.dirname(masterAbs), { recursive: true });
    await copyFile(row.staged_file, masterAbs);
    const deployedAbs = path.join(ARTWORK_DEPLOY_ROOT, row.album_id, filename);
    await mkdir(path.dirname(deployedAbs), { recursive: true });
    await copyFile(masterAbs, deployedAbs);
    const canonicalPath = deployedCanonicalPath(row.album_id, filename);

    const nextStatus = row.tier === "high" ? "verified" : "pending";
    const nextState = row.tier === "high" ? "canonical_verified" : "needs_review";
    const source = `itunes_living:${sourceRunId}`;
    const notes = `living_archive_apply; tier=${row.tier}; confidence=${row.best_candidate?.score ?? "n/a"}; source=${row.best_candidate?.artist_name ?? ""}::${row.best_candidate?.collection_name ?? ""}; master=${path.relative(ARTWORK_MASTER_ROOT, masterAbs)}`;

    if (primary?.retroverse_album_artwork_id) {
      const { error } = await supabase
        .from("retroverse_album_artwork")
        .update({
          canonical_cover_path: canonicalPath,
          cover_source: source,
          artwork_status: nextStatus,
          artwork_role: "primary",
          is_primary: true,
          notes,
        })
        .eq("retroverse_album_artwork_id", primary.retroverse_album_artwork_id);
      if (error) {
        skipped.push({ album_id: row.album_id, reason: `update_failed:${error.message}` });
        continue;
      }
    } else {
      const newId = await nextArtworkId(supabase);
      const { error } = await supabase.from("retroverse_album_artwork").insert({
        retroverse_album_artwork_id: newId,
        retroverse_album_id: row.album_id,
        retroverse_album_edition_id: null,
        artwork_role: "primary",
        is_primary: true,
        canonical_cover_path: canonicalPath,
        cover_source: source,
        artwork_status: nextStatus,
        width_px: null,
        height_px: null,
        notes,
      });
      if (error) {
        skipped.push({ album_id: row.album_id, reason: `insert_failed:${error.message}` });
        continue;
      }
    }

    upsertArtworkState(registry, {
      albumId: row.album_id,
      nextState,
      confidenceScore: row.best_candidate?.score ?? null,
      provisional: row.tier !== "high",
      provenanceSource: source,
      provenanceRunId: sourceRunId,
      candidateArtist: row.best_candidate?.artist_name ?? null,
      candidateCollection: row.best_candidate?.collection_name ?? null,
      candidateReleaseDate: row.best_candidate?.release_date ?? null,
      candidateArtworkUrl: row.best_candidate?.artwork_url_600 ?? null,
      stagedFile: row.staged_file,
      queryUsed: row.query_used_for_best ?? null,
      normalizedQuery: row.normalized_query ?? null,
      appliedAt: new Date().toISOString(),
      action: row.tier === "high" ? "auto_apply_high" : "auto_apply_medium",
      actor: "system",
      notes,
      dbSnapshotBefore: primary as unknown as Record<string, unknown> | null,
    });

    if (row.tier === "high") appliedHigh.push(row.album_id);
    else appliedMediumNeedsReview.push(row.album_id);
  }

  // Register unresolved visibility state in the living registry.
  const unresolvedRows =
    refinementSummary?.rows.filter((row) => row.tier === "unresolved") ??
    acquisitionSummary?.rows.filter((row) => row.tier === "unresolved") ??
    [];
  for (const row of unresolvedRows) {
    const hasCandidate = Boolean(row.best_candidate);
    upsertArtworkState(registry, {
      albumId: row.album_id,
      nextState: hasCandidate ? "provisional" : "unresolved",
      confidenceScore: row.best_candidate?.score ?? null,
      provisional: hasCandidate,
      provenanceSource: "itunes_living:unresolved",
      provenanceRunId: refinementSummary?.run_id ?? acquisitionSummary?.run_id ?? null,
      candidateArtist: row.best_candidate?.artist_name ?? null,
      candidateCollection: row.best_candidate?.collection_name ?? null,
      candidateReleaseDate: row.best_candidate?.release_date ?? null,
      candidateArtworkUrl: row.best_candidate?.artwork_url_600 ?? null,
      stagedFile: row.staged_file ?? null,
      queryUsed: row.query_used_for_best ?? null,
      normalizedQuery: row.normalized_query ?? null,
      appliedAt: null,
      action: hasCandidate ? "provisional_candidate" : "unresolved_marker",
      actor: "system",
      notes: "living archive unresolved registration",
    });
  }

  await saveArtworkStateRegistry(registry);

  const summaryPath = path.join(logDir, "living_apply_summary.json");
  const summary = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    source_acquisition_run: acquisitionSummary?.run_id ?? null,
    source_refinement_run: refinementSummary?.run_id ?? null,
    pre_snapshot: beforeSnapshotPath,
    applied_high_count: appliedHigh.length,
    applied_medium_needs_review_count: appliedMediumNeedsReview.length,
    unresolved_registered_count: unresolvedRows.length,
    skipped_count: skipped.length,
    applied_high: appliedHigh,
    applied_medium_needs_review: appliedMediumNeedsReview,
    skipped,
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8");

  console.log(`living_apply_summary_json=${summaryPath}`);
  console.log(`applied_high=${appliedHigh.length}`);
  console.log(`applied_medium_needs_review=${appliedMediumNeedsReview.length}`);
  console.log(`unresolved_registered=${unresolvedRows.length}`);
  console.log(`skipped=${skipped.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
