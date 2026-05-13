import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

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

type ReviewFile = {
  generated_at: string;
  run_id: string;
  source_summary: string;
  total_high_downloaded: number;
  decisions: ReviewRow[];
};

type ArtworkRow = {
  retroverse_album_artwork_id: string;
  retroverse_album_id: string;
  is_primary?: boolean;
  artwork_role?: string | null;
};

const WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";
const ITUNES_PASS_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass";
const APPLY_LOG_ROOT = "/Users/bobhopp/RETROVERSE_DATA/logs/artwork-apply";

function parseArgs(): { reviewPathArg: string | null } {
  const args = process.argv.slice(2);
  let reviewPathArg: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--review" && args[i + 1]) {
      reviewPathArg = args[i + 1];
      i += 1;
    }
  }
  return { reviewPathArg };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

async function latestReviewPath(): Promise<string> {
  const entries = await import("node:fs/promises").then((m) => m.readdir(ITUNES_PASS_ROOT, { withFileTypes: true }));
  const runDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("itunes_canonical_pass_"))
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a));
  if (runDirs.length === 0) throw new Error(`No iTunes pass directory found under ${ITUNES_PASS_ROOT}`);
  return path.join(ITUNES_PASS_ROOT, runDirs[0], "review", "high_confidence_review.json");
}

async function main() {
  const { reviewPathArg } = parseArgs();
  const reviewPath = reviewPathArg ?? (await latestReviewPath());
  const raw = await readFile(reviewPath, "utf8");
  const review = JSON.parse(raw) as ReviewFile;
  const approved = review.decisions.filter((row) => row.decision === "approve");

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before apply.");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const runId = `apply_itunes_approved_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const logDir = path.join(APPLY_LOG_ROOT, runId);
  await mkdir(logDir, { recursive: true });

  // Snapshot before mutation for rollback safety.
  const { data: preRows, error: preErr } = await supabase
    .from("retroverse_album_artwork")
    .select(
      "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, is_primary, canonical_cover_path, cover_source, artwork_status, notes, created_at",
    );
  if (preErr) throw preErr;
  const preSnapshotPath = path.join(logDir, "pre_apply_artwork_rows.json");
  await writeFile(
    preSnapshotPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        review_source: reviewPath,
        run_id: review.run_id,
        total_rows: preRows?.length ?? 0,
        rows: preRows ?? [],
      },
      null,
      2,
    ),
    "utf8",
  );

  const albumIds = [...new Set(approved.map((row) => row.album_id))];
  const { data: existingRows, error: existingErr } = await supabase
    .from("retroverse_album_artwork")
    .select("retroverse_album_artwork_id, retroverse_album_id, is_primary, artwork_role")
    .in("retroverse_album_id", albumIds);
  if (existingErr) throw existingErr;
  const byAlbum = new Map<string, ArtworkRow[]>();
  for (const row of (existingRows ?? []) as ArtworkRow[]) {
    byAlbum.set(row.retroverse_album_id, [...(byAlbum.get(row.retroverse_album_id) ?? []), row]);
  }

  const { data: allRowsForId, error: idErr } = await supabase
    .from("retroverse_album_artwork")
    .select("retroverse_album_artwork_id");
  if (idErr) throw idErr;
  let nextOrdinal =
    Math.max(
      0,
      ...(allRowsForId ?? []).map((row) => {
        const match = String(row.retroverse_album_artwork_id).match(/^RVAW(\d+)$/);
        return match ? Number.parseInt(match[1], 10) : 0;
      }),
    ) + 1;

  const applied: Array<{ album_id: string; canonical_cover_path: string; action: "update" | "insert" }> = [];
  const skipped: Array<{ album_id: string; reason: string }> = [];

  for (const row of approved) {
    if (!row.staged_file) {
      skipped.push({ album_id: row.album_id, reason: "missing_staged_file" });
      continue;
    }

    const extension = path.extname(row.staged_file) || ".jpg";
    const filename = `${row.album_id}__${slugify(row.artist)}__${slugify(row.title)}${extension}`;
    const albumDir = path.join(WORKSPACE_ROOT, "public/retroverse/covers", row.album_id);
    await mkdir(albumDir, { recursive: true });
    const deployAbsPath = path.join(albumDir, filename);
    await copyFile(row.staged_file, deployAbsPath);
    const canonicalPath = `public/retroverse/covers/${row.album_id}/${filename}`;

    const candidates = byAlbum.get(row.album_id) ?? [];
    const target = candidates.find((candidate) => candidate.is_primary) ?? candidates.find((candidate) => candidate.artwork_role === "primary") ?? candidates[0];
    const notes = `iTunes canonical pass ${review.run_id}; confidence=${row.confidence_score}; source=${row.source_artist}::${row.source_collection}`;

    if (target?.retroverse_album_artwork_id) {
      const { error } = await supabase
        .from("retroverse_album_artwork")
        .update({
          canonical_cover_path: canonicalPath,
          cover_source: "itunes_canonical_pass",
          artwork_status: "verified",
          artwork_role: "primary",
          is_primary: true,
          notes,
        })
        .eq("retroverse_album_artwork_id", target.retroverse_album_artwork_id);
      if (error) {
        skipped.push({ album_id: row.album_id, reason: `update_failed:${error.message}` });
        continue;
      }
      applied.push({ album_id: row.album_id, canonical_cover_path: canonicalPath, action: "update" });
    } else {
      const newArtworkId = `RVAW${String(nextOrdinal).padStart(6, "0")}`;
      nextOrdinal += 1;
      const { data: inserted, error } = await supabase
        .from("retroverse_album_artwork")
        .insert({
          retroverse_album_artwork_id: newArtworkId,
          retroverse_album_id: row.album_id,
          retroverse_album_edition_id: null,
          artwork_role: "primary",
          is_primary: true,
          canonical_cover_path: canonicalPath,
          cover_source: "itunes_canonical_pass",
          artwork_status: "verified",
          width_px: null,
          height_px: null,
          notes,
        })
        .select("retroverse_album_artwork_id")
        .single();
      if (error) {
        skipped.push({ album_id: row.album_id, reason: `insert_failed:${error.message}` });
        continue;
      }
      byAlbum.set(row.album_id, [
        ...(byAlbum.get(row.album_id) ?? []),
        {
          retroverse_album_artwork_id: inserted.retroverse_album_artwork_id,
          retroverse_album_id: row.album_id,
          is_primary: true,
          artwork_role: "primary",
        },
      ]);
      applied.push({ album_id: row.album_id, canonical_cover_path: canonicalPath, action: "insert" });
    }
  }

  const outPath = path.join(logDir, "apply_summary.json");
  await writeFile(
    outPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        review_source: reviewPath,
        run_id: review.run_id,
        approved_rows: approved.length,
        applied_count: applied.length,
        skipped_count: skipped.length,
        applied,
        skipped,
        pre_snapshot: preSnapshotPath,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`apply_summary_json=${outPath}`);
  console.log(`pre_apply_snapshot=${preSnapshotPath}`);
  console.log(`approved_rows=${approved.length}`);
  console.log(`applied_count=${applied.length}`);
  console.log(`skipped_count=${skipped.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
