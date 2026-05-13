import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

type InputRow = {
  retroverse_album_id: string;
  artist: string;
  album: string;
  release_year: number | null;
  source: string;
  artwork_url: string;
  staged_file_path: string;
  proposed_status: "verified" | "pending" | "missing";
  confidence: number;
  query_used: string;
  notes: string;
};

type ArtworkRow = {
  retroverse_album_artwork_id: string;
  retroverse_album_id: string;
  retroverse_album_edition_id: string | null;
  artwork_role: string;
  is_primary: boolean;
  artwork_status: "missing" | "pending" | "verified" | "rejected";
  canonical_cover_path: string | null;
  cover_source: string | null;
};

const WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";
const INPUT_CSV = "/Users/bobhopp/RETROVERSE_DATA/generated/artwork_restoration/acquisition_results.csv";

function csvSplit(line: string): string[] {
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

function parseInteger(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseFloatValue(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function parseRows(raw: string): InputRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) return [];
  const headers = csvSplit(lines[0]);
  return lines.slice(1).map((line) => {
    const values = csvSplit(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    const proposedStatus = row.proposed_status as InputRow["proposed_status"];
    return {
      retroverse_album_id: row.retroverse_album_id,
      artist: row.artist,
      album: row.album,
      release_year: parseInteger(row.release_year),
      source: row.source,
      artwork_url: row.artwork_url,
      staged_file_path: row.staged_file_path,
      proposed_status: proposedStatus,
      confidence: parseFloatValue(row.confidence),
      query_used: row.query_used,
      notes: row.notes,
    };
  });
}

function parseApprovedIds(): Set<string> {
  const raw = process.env.ARTWORK_RESTORATION_APPROVED_IDS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
}

async function main() {
  const approvedIds = parseApprovedIds();
  const allowOverwriteVerified = (process.env.ARTWORK_RESTORATION_ALLOW_OVERWRITE_VERIFIED ?? "false").toLowerCase() === "true";

  const raw = await readFile(INPUT_CSV, "utf8");
  const rows = parseRows(raw);
  const candidates = rows.filter((row) => row.proposed_status !== "missing");

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before apply.");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const albumIds = [...new Set(candidates.map((row) => row.retroverse_album_id))];
  const { data: existingRows, error: existingError } = await supabase
    .from("retroverse_album_artwork")
    .select(
      "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, is_primary, artwork_status, canonical_cover_path, cover_source",
    )
    .in("retroverse_album_id", albumIds);
  if (existingError) throw existingError;

  const byAlbum = new Map<string, ArtworkRow[]>();
  for (const row of (existingRows ?? []) as ArtworkRow[]) {
    byAlbum.set(row.retroverse_album_id, [...(byAlbum.get(row.retroverse_album_id) ?? []), row]);
  }

  const { data: allIds, error: idError } = await supabase.from("retroverse_album_artwork").select("retroverse_album_artwork_id");
  if (idError) throw idError;
  let nextId =
    Math.max(
      0,
      ...(allIds ?? []).map((row) => {
        const match = String(row.retroverse_album_artwork_id).match(/^RVAW(\d+)$/);
        return match ? Number.parseInt(match[1], 10) : 0;
      }),
    ) + 1;

  let inserted = 0;
  let updated = 0;
  let skippedExistingVerified = 0;
  let errors = 0;

  for (const row of candidates) {
    const isExplicitApproved = approvedIds.has(row.retroverse_album_id);
    if (row.proposed_status === "pending" && !isExplicitApproved) {
      continue;
    }
    if (!row.staged_file_path) {
      errors += 1;
      continue;
    }

    const existing = byAlbum.get(row.retroverse_album_id) ?? [];
    const verifiedExisting = existing.find((artwork) => artwork.artwork_status === "verified");
    if (verifiedExisting && !allowOverwriteVerified) {
      skippedExistingVerified += 1;
      continue;
    }

    const extension = path.extname(row.staged_file_path) || ".jpg";
    const filename = `${row.retroverse_album_id}__${slugify(row.artist)}__${slugify(row.album)}${extension}`;
    const albumDir = path.join(WORKSPACE_ROOT, "public/retroverse/covers", row.retroverse_album_id);
    await mkdir(albumDir, { recursive: true });
    const deployAbsPath = path.join(albumDir, filename);
    await copyFile(row.staged_file_path, deployAbsPath);
    const canonicalCoverPath = `public/retroverse/covers/${row.retroverse_album_id}/${filename}`;

    const target =
      existing.find((artwork) => artwork.is_primary) ??
      existing.find((artwork) => artwork.artwork_role === "primary") ??
      existing[0];

    const notes = `artwork_restoration_v2 source=${row.source} confidence=${row.confidence} query=${row.query_used}`;

    if (target?.retroverse_album_artwork_id) {
      const { error } = await supabase
        .from("retroverse_album_artwork")
        .update({
          canonical_cover_path: canonicalCoverPath,
          cover_source: row.source,
          artwork_status: row.proposed_status,
          artwork_role: "primary",
          is_primary: true,
          notes,
        })
        .eq("retroverse_album_artwork_id", target.retroverse_album_artwork_id);
      if (error) {
        errors += 1;
        continue;
      }
      updated += 1;
      continue;
    }

    const newId = `RVAW${String(nextId).padStart(6, "0")}`;
    nextId += 1;
    const { data: insertedRow, error } = await supabase
      .from("retroverse_album_artwork")
      .insert({
        retroverse_album_artwork_id: newId,
        retroverse_album_id: row.retroverse_album_id,
        retroverse_album_edition_id: null,
        artwork_role: "primary",
        is_primary: true,
        canonical_cover_path: canonicalCoverPath,
        cover_source: row.source,
        artwork_status: row.proposed_status,
        width_px: null,
        height_px: null,
        notes,
      })
      .select("retroverse_album_artwork_id")
      .single();
    if (error || !insertedRow) {
      errors += 1;
      continue;
    }
    inserted += 1;
  }

  console.log(`rows_inserted=${inserted}`);
  console.log(`rows_updated=${updated}`);
  console.log(`skipped_existing_verified=${skippedExistingVerified}`);
  console.log(`errors=${errors}`);
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(message);
  process.exitCode = 1;
});
