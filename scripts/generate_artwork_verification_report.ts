import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

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

type ArtworkRow = {
  retroverse_album_artwork_id: string;
  retroverse_album_id: string;
  canonical_cover_path: string | null;
  is_primary?: boolean;
  artwork_role?: string | null;
  cover_source?: string | null;
  artwork_status?: string | null;
  notes?: string | null;
};

type ReconciliationMap = Map<
  string,
  {
    confidence: number;
    source_file: string;
    candidate_count: number;
    reasons: string[];
    run_id: string;
  }
>;

type VerificationRow = {
  album_id: string;
  artist: string;
  title: string;
  release_year: number | null;
  canonical_cover_path: string;
  cover_file_basename: string;
  cover_source: string | null;
  artwork_status: string | null;
  source_filename_traceable: string | null;
  match_confidence: number | null;
  match_source: string;
  candidate_count: number | null;
  heuristic_flags: string[];
  visual_review_status: "review_needed" | "suspicious" | "verified_placeholder";
  file_exists: boolean;
  file_size_bytes: number | null;
};

const WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";
const RECON_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/reconciliation";
const OUTPUT_ROOT = "/Users/bobhopp/RETROVERSE_DATA/logs/artwork-verification";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(value: string, list: string[]): boolean {
  const n = normalize(value);
  return list.some((token) => n.includes(token));
}

async function loadLatestReconciliationMap(): Promise<{
  byAlbum: ReconciliationMap;
  runId: string | null;
}> {
  const byAlbum: ReconciliationMap = new Map();
  try {
    const entries = await readdir(RECON_ROOT, { withFileTypes: true });
    const latest = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("local_artwork_reconciliation_"))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))[0];
    if (!latest) return { byAlbum, runId: null };

    const summaryPath = path.join(RECON_ROOT, latest, "reconciliation_summary.json");
    const raw = await readFile(summaryPath, "utf8");
    const parsed = JSON.parse(raw) as {
      run_id: string;
      high_confidence_queue?: Array<{
        album_id: string;
        confidence: number;
        selected_file: string | null;
        candidate_count: number;
        reasons: string[];
      }>;
    };
    for (const row of parsed.high_confidence_queue ?? []) {
      if (!row.selected_file) continue;
      byAlbum.set(row.album_id, {
        confidence: row.confidence,
        source_file: row.selected_file,
        candidate_count: row.candidate_count,
        reasons: row.reasons ?? [],
        run_id: parsed.run_id,
      });
    }
    return { byAlbum, runId: parsed.run_id };
  } catch {
    return { byAlbum, runId: null };
  }
}

function pickCanonicalArtwork(rows: ArtworkRow[]): ArtworkRow | null {
  return (
    rows.find((row) => row.is_primary && row.canonical_cover_path) ??
    rows.find((row) => row.artwork_role === "primary" && row.canonical_cover_path) ??
    rows.find((row) => row.canonical_cover_path) ??
    null
  );
}

function heuristicFlags(row: {
  artist: string;
  title: string;
  coverSource: string | null;
  sourceFilenameTraceable: string | null;
  matchConfidence: number | null;
  candidateCount: number | null;
  reasons: string[];
}): string[] {
  const flags: string[] = [];
  const title = row.title;
  const artist = row.artist;

  if (
    hasAny(title, [
      "greatest hits",
      "best of",
      "anthology",
      "collection",
      "volume",
      "vol ",
      "soundtrack",
      "original motion picture",
    ])
  ) {
    flags.push("greatest_hits_or_compilation_ambiguity");
  }
  if (normalize(artist) === "various artists") {
    flags.push("various_artists_ambiguity");
  }
  if ((row.candidateCount ?? 0) > 1) {
    flags.push("multiple_local_candidates");
  }
  if (row.matchConfidence !== null && row.matchConfidence < 0.97) {
    flags.push("below_top_confidence_band");
  }
  if (!row.reasons.some((reason) => reason.startsWith("artist_"))) {
    flags.push("title_only_signal");
  }
  if (/[()]/.test(title)) {
    flags.push("title_parentheses_variant");
  }
  if (!row.coverSource || row.coverSource === "retroverse_cover_archive") {
    flags.push("legacy_source_without_recent_provenance");
  }
  if (row.sourceFilenameTraceable === null) {
    flags.push("source_filename_untraceable");
  }

  return [...new Set(flags)];
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before verification.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ byAlbum: reconByAlbum, runId: reconciliationRunId }, albumsResult, artistsResult, artworkResult] = await Promise.all([
    loadLatestReconciliationMap(),
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase
      .from("retroverse_album_artwork")
      .select(
        "retroverse_album_artwork_id, retroverse_album_id, canonical_cover_path, is_primary, artwork_role, cover_source, artwork_status, notes",
      ),
  ]);

  for (const result of [albumsResult, artistsResult, artworkResult]) {
    if (result.error) throw result.error;
  }

  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const artists = (artistsResult.data ?? []) as ArtistRow[];
  const artworkRows = ((artworkResult.data ?? []) as ArtworkRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? row.artwork_role === "primary",
  }));

  const artistById = new Map(artists.map((artist) => [artist.retroverse_artist_id, artist.canonical_artist_name]));
  const artworkByAlbumId = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    artworkByAlbumId.set(row.retroverse_album_id, [...(artworkByAlbumId.get(row.retroverse_album_id) ?? []), row]);
  }

  const rows: VerificationRow[] = [];
  for (const album of albums) {
    const artist = artistById.get(album.retroverse_artist_id) ?? "Unknown artist";
    const candidate = pickCanonicalArtwork(artworkByAlbumId.get(album.retroverse_album_id) ?? []);
    if (!candidate?.canonical_cover_path) continue;

    const localPath = path.join(WORKSPACE_ROOT, candidate.canonical_cover_path.replace(/^\/+/, ""));
    let exists = false;
    let fileSize: number | null = null;
    try {
      const info = await stat(localPath);
      exists = true;
      fileSize = info.size;
    } catch {
      exists = false;
      fileSize = null;
    }

    const recon = reconByAlbum.get(album.retroverse_album_id) ?? null;
    const sourceFilename = recon?.source_file ?? (candidate.notes?.match(/covers_master:\s*(.+)$/)?.[1]?.trim() ?? null);
    const reasonList = recon?.reasons ?? [];
    const flags = heuristicFlags({
      artist,
      title: album.canonical_album_title,
      coverSource: candidate.cover_source ?? null,
      sourceFilenameTraceable: sourceFilename,
      matchConfidence: recon?.confidence ?? null,
      candidateCount: recon?.candidate_count ?? null,
      reasons: reasonList,
    });

    rows.push({
      album_id: album.retroverse_album_id,
      artist,
      title: album.canonical_album_title,
      release_year: album.release_year,
      canonical_cover_path: candidate.canonical_cover_path,
      cover_file_basename: path.basename(candidate.canonical_cover_path),
      cover_source: candidate.cover_source ?? null,
      artwork_status: candidate.artwork_status ?? null,
      source_filename_traceable: sourceFilename,
      match_confidence: recon?.confidence ?? null,
      match_source: recon ? "local_reconciliation" : "legacy_or_untracked",
      candidate_count: recon?.candidate_count ?? null,
      heuristic_flags: flags,
      visual_review_status: flags.length > 0 ? "suspicious" : "review_needed",
      file_exists: exists,
      file_size_bytes: fileSize,
    });
  }

  rows.sort((a, b) => {
    if (a.visual_review_status !== b.visual_review_status) return a.visual_review_status.localeCompare(b.visual_review_status);
    return a.album_id.localeCompare(b.album_id);
  });

  const suspicious = rows.filter((row) => row.heuristic_flags.length > 0);
  const reviewNeeded = rows.filter((row) => row.heuristic_flags.length === 0);
  const runId = `artwork_verification_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outDir = path.join(OUTPUT_ROOT, runId);
  await mkdir(outDir, { recursive: true });

  const grouped: VerificationRow[][] = [];
  for (let i = 0; i < rows.length; i += 25) grouped.push(rows.slice(i, i + 25));

  const summary = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    reconciliation_reference_run: reconciliationRunId,
    totals: {
      canonical_assigned: rows.length,
      suspicious: suspicious.length,
      review_needed: reviewNeeded.length,
      missing_file_rows: rows.filter((row) => !row.file_exists).length,
    },
    rows,
  };

  const jsonPath = path.join(outDir, "artwork_verification.json");
  const mdPath = path.join(outDir, "artwork_verification.md");
  const htmlPath = path.join(outDir, "artwork_contact_sheet.html");

  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const mdLines: string[] = [
    `# Retroverse Artwork Verification ${runId}`,
    "",
    `- canonical assigned rows: ${rows.length}`,
    `- suspicious heuristic rows: ${suspicious.length}`,
    `- review-needed rows: ${reviewNeeded.length}`,
    `- reconciliation reference: ${reconciliationRunId ?? "none"}`,
    "",
    "## Heuristic flags",
    "- greatest_hits_or_compilation_ambiguity",
    "- various_artists_ambiguity",
    "- multiple_local_candidates",
    "- below_top_confidence_band",
    "- title_only_signal",
    "- title_parentheses_variant",
    "- legacy_source_without_recent_provenance",
    "- source_filename_untraceable",
    "",
  ];

  grouped.forEach((batch, idx) => {
    mdLines.push(`## Batch ${idx + 1} (${batch.length})`);
    mdLines.push("");
    mdLines.push("| Cover | Album ID | Artist | Title | Path | Source | Confidence | Flags | Review |");
    mdLines.push("|---|---|---|---|---|---|---:|---|---|");
    for (const row of batch) {
      const imageAbs = path.join(WORKSPACE_ROOT, row.canonical_cover_path.replace(/^\/+/, ""));
      mdLines.push(
        `| <img src="file://${imageAbs}" width="80" /> | ${row.album_id} | ${row.artist} | ${row.title} | \`${row.canonical_cover_path}\` | ${row.source_filename_traceable ?? "n/a"} | ${row.match_confidence ?? "n/a"} | ${row.heuristic_flags.join(", ") || "none"} | ${row.visual_review_status} |`,
      );
    }
    mdLines.push("");
  });

  await writeFile(mdPath, mdLines.join("\n"), "utf8");

  const htmlRows = rows
    .map((row) => {
      const imageAbs = path.join(WORKSPACE_ROOT, row.canonical_cover_path.replace(/^\/+/, ""));
      return `
<article class="card ${row.heuristic_flags.length > 0 ? "suspicious" : "review"}">
  <img src="file://${imageAbs}" alt="${row.title} cover" />
  <div class="meta">
    <h3>${row.artist} - ${row.title}</h3>
    <p><strong>${row.album_id}</strong> (${row.release_year ?? "n/a"})</p>
    <p>path: <code>${row.canonical_cover_path}</code></p>
    <p>source file: ${row.source_filename_traceable ?? "n/a"}</p>
    <p>match: ${row.match_source} ${row.match_confidence !== null ? `(confidence ${row.match_confidence})` : ""}</p>
    <p>flags: ${row.heuristic_flags.join(", ") || "none"}</p>
    <p>review status: <strong>${row.visual_review_status}</strong></p>
  </div>
</article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Retroverse Artwork Verification ${runId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 20px; background: #f7f5ef; color: #24211d; }
    h1 { margin-bottom: 8px; }
    .summary { margin: 0 0 16px; font-size: 14px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
    .card { background: #fffaf0; border: 1px solid #c8bda6; border-radius: 8px; overflow: hidden; }
    .card.suspicious { border-color: #a7482b; background: #fff4ef; }
    .card img { width: 100%; height: 280px; object-fit: cover; background: #ddd; }
    .meta { padding: 10px 12px 12px; font-size: 12px; line-height: 1.35; }
    .meta h3 { margin: 0 0 6px; font-size: 14px; }
    .meta p { margin: 4px 0; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
  </style>
</head>
<body>
  <h1>Retroverse Artwork Verification</h1>
  <p class="summary">
    canonical rows: ${rows.length} |
    suspicious: ${suspicious.length} |
    review-needed: ${reviewNeeded.length} |
    reconciliation reference: ${reconciliationRunId ?? "none"}
  </p>
  <section class="grid">
    ${htmlRows}
  </section>
</body>
</html>`;
  await writeFile(htmlPath, html, "utf8");

  console.log(`artwork_verification_json=${jsonPath}`);
  console.log(`artwork_verification_md=${mdPath}`);
  console.log(`artwork_contact_sheet_html=${htmlPath}`);
  console.log(`canonical_assigned=${rows.length}`);
  console.log(`suspicious=${suspicious.length}`);
  console.log(`review_needed=${reviewNeeded.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
