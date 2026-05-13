import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
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
};

type LocalArtworkFile = {
  filename: string;
  absPath: string;
  extension: string;
  sizeBytes: number;
  parseKind: "artist_album_underscore" | "artist_album_dash" | "unparsed";
  artistRaw: string | null;
  albumRaw: string | null;
  artistKey: string | null;
  albumKey: string | null;
  artistLooseKey: string | null;
  albumLooseKey: string | null;
};

type MatchCandidate = {
  source: LocalArtworkFile;
  score: number;
  reasons: string[];
};

type MatchDecision = {
  album_id: string;
  title: string;
  artist: string;
  release_year: number | null;
  status: "high_confidence" | "medium_confidence" | "no_match";
  confidence: number;
  selected_file: string | null;
  selected_source_path: string | null;
  candidate_count: number;
  reasons: string[];
};

const WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";
const COVERS_MASTER_ROOT = process.env.RETROVERSE_COVERS_MASTER_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/covers_master";
const RECON_ROOT = process.env.RETROVERSE_ARTWORK_RECON_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/reconciliation";

function parseArgs() {
  const args = process.argv.slice(2);
  return {
    applyHighConfidence: args.includes("--apply-high-confidence"),
  };
}

function stripParenthetical(value: string): string {
  return value.replace(/\(.*?\)/g, " ").replace(/\[.*?\]/g, " ");
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['".,!?/\\:;`~*+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLooseKey(value: string): string {
  return normalizeKey(stripParenthetical(value))
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function parseLocalFilename(filename: string): {
  parseKind: LocalArtworkFile["parseKind"];
  artistRaw: string | null;
  albumRaw: string | null;
} {
  const stem = filename.replace(/\.[^.]+$/, "");
  if (stem.includes("_-_")) {
    const [artistRaw, ...rest] = stem.split("_-_");
    return {
      parseKind: "artist_album_underscore",
      artistRaw: artistRaw.replace(/_/g, " ").trim(),
      albumRaw: rest.join("_-_").replace(/_/g, " ").trim(),
    };
  }
  if (stem.includes(" - ")) {
    const [artistRaw, ...rest] = stem.split(" - ");
    return {
      parseKind: "artist_album_dash",
      artistRaw: artistRaw.replace(/_/g, " ").trim(),
      albumRaw: rest.join(" - ").replace(/_/g, " ").trim(),
    };
  }
  return {
    parseKind: "unparsed",
    artistRaw: null,
    albumRaw: null,
  };
}

function scoreCandidate(
  candidate: LocalArtworkFile,
  artistKey: string,
  artistLooseKey: string,
  titleKey: string,
  titleLooseKey: string,
): MatchCandidate {
  let score = 0;
  const reasons: string[] = [];

  if (candidate.albumKey && candidate.albumKey === titleKey) {
    score += 0.62;
    reasons.push("title_exact");
  } else if (candidate.albumLooseKey && candidate.albumLooseKey === titleLooseKey) {
    score += 0.4;
    reasons.push("title_loose");
  } else if (candidate.albumKey && (candidate.albumKey.includes(titleKey) || titleKey.includes(candidate.albumKey))) {
    score += 0.25;
    reasons.push("title_contains");
  }

  if (candidate.artistKey && candidate.artistKey === artistKey) {
    score += 0.35;
    reasons.push("artist_exact");
  } else if (candidate.artistLooseKey && candidate.artistLooseKey === artistLooseKey) {
    score += 0.22;
    reasons.push("artist_loose");
  } else if (candidate.artistKey && (candidate.artistKey.includes(artistLooseKey) || artistLooseKey.includes(candidate.artistKey))) {
    score += 0.12;
    reasons.push("artist_contains");
  }

  const bounded = Number(Math.min(1, score).toFixed(3));
  return { source: candidate, score: bounded, reasons };
}

async function collectLocalArtworkFiles(): Promise<{
  files: LocalArtworkFile[];
  parseStats: Record<LocalArtworkFile["parseKind"], number>;
  extensionStats: Record<string, number>;
}> {
  const entries = await readdir(COVERS_MASTER_ROOT, { withFileTypes: true });
  const files: LocalArtworkFile[] = [];
  const parseStats: Record<LocalArtworkFile["parseKind"], number> = {
    artist_album_underscore: 0,
    artist_album_dash: 0,
    unparsed: 0,
  };
  const extensionStats: Record<string, number> = {};

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    const ext = path.extname(lower).replace(".", "");
    if (!["jpg", "jpeg", "png", "webp"].includes(ext)) continue;
    const parsed = parseLocalFilename(entry.name);
    const absPath = path.join(COVERS_MASTER_ROOT, entry.name);
    const info = await stat(absPath);
    parseStats[parsed.parseKind] += 1;
    extensionStats[ext] = (extensionStats[ext] ?? 0) + 1;
    files.push({
      filename: entry.name,
      absPath,
      extension: ext,
      sizeBytes: info.size,
      parseKind: parsed.parseKind,
      artistRaw: parsed.artistRaw,
      albumRaw: parsed.albumRaw,
      artistKey: parsed.artistRaw ? normalizeKey(parsed.artistRaw) : null,
      albumKey: parsed.albumRaw ? normalizeKey(parsed.albumRaw) : null,
      artistLooseKey: parsed.artistRaw ? normalizeLooseKey(parsed.artistRaw) : null,
      albumLooseKey: parsed.albumRaw ? normalizeLooseKey(parsed.albumRaw) : null,
    });
  }

  return { files, parseStats, extensionStats };
}

async function main() {
  const { applyHighConfidence } = parseArgs();
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running local reconciliation.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [albumsResult, artistsResult, artworkResult] = await Promise.all([
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase.from("retroverse_album_artwork").select("retroverse_album_artwork_id, retroverse_album_id, canonical_cover_path, is_primary, artwork_role"),
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

  const artistNameById = new Map(artists.map((artist) => [artist.retroverse_artist_id, artist.canonical_artist_name]));
  const artworkByAlbumId = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    artworkByAlbumId.set(row.retroverse_album_id, [...(artworkByAlbumId.get(row.retroverse_album_id) ?? []), row]);
  }
  let nextArtworkOrdinal =
    Math.max(
      0,
      ...artworkRows.map((row) => {
        const match = row.retroverse_album_artwork_id.match(/^RVAW(\d+)$/);
        return match ? Number.parseInt(match[1], 10) : 0;
      }),
    ) + 1;

  const { files: localFiles, parseStats, extensionStats } = await collectLocalArtworkFiles();

  const filesByAlbumKey = new Map<string, LocalArtworkFile[]>();
  const filesByAlbumLoose = new Map<string, LocalArtworkFile[]>();
  for (const file of localFiles) {
    if (file.albumKey) {
      filesByAlbumKey.set(file.albumKey, [...(filesByAlbumKey.get(file.albumKey) ?? []), file]);
    }
    if (file.albumLooseKey) {
      filesByAlbumLoose.set(file.albumLooseKey, [...(filesByAlbumLoose.get(file.albumLooseKey) ?? []), file]);
    }
  }

  const decisions: MatchDecision[] = [];
  for (const album of albums) {
    const artist = artistNameById.get(album.retroverse_artist_id) ?? "Unknown artist";
    const titleKey = normalizeKey(album.canonical_album_title);
    const titleLooseKey = normalizeLooseKey(album.canonical_album_title);
    const artistKey = normalizeKey(artist);
    const artistLooseKey = normalizeLooseKey(artist);

    const candidates = new Map<string, LocalArtworkFile>();
    for (const file of filesByAlbumKey.get(titleKey) ?? []) candidates.set(file.filename, file);
    for (const file of filesByAlbumLoose.get(titleLooseKey) ?? []) candidates.set(file.filename, file);

    const scored = [...candidates.values()]
      .map((candidate) => scoreCandidate(candidate, artistKey, artistLooseKey, titleKey, titleLooseKey))
      .sort((a, b) => b.score - a.score || b.source.sizeBytes - a.source.sizeBytes);

    if (scored.length === 0) {
      decisions.push({
        album_id: album.retroverse_album_id,
        title: album.canonical_album_title,
        artist,
        release_year: album.release_year,
        status: "no_match",
        confidence: 0,
        selected_file: null,
        selected_source_path: null,
        candidate_count: 0,
        reasons: [],
      });
      continue;
    }

    const best = scored[0];
    const secondScore = scored[1]?.score ?? 0;
    const margin = Number((best.score - secondScore).toFixed(3));
    const highConfidence = best.score >= 0.95 && margin >= 0.08 && best.reasons.includes("title_exact") && best.reasons.some((r) => r.startsWith("artist_"));
    const mediumConfidence = best.score >= 0.8;

    decisions.push({
      album_id: album.retroverse_album_id,
      title: album.canonical_album_title,
      artist,
      release_year: album.release_year,
      status: highConfidence ? "high_confidence" : mediumConfidence ? "medium_confidence" : "no_match",
      confidence: best.score,
      selected_file: best.source.filename,
      selected_source_path: best.source.absPath,
      candidate_count: scored.length,
      reasons: [...best.reasons, `margin:${margin}`],
    });
  }

  const highConfidence = decisions.filter((decision) => decision.status === "high_confidence");
  const mediumConfidence = decisions.filter((decision) => decision.status === "medium_confidence");
  const unresolved = decisions.filter((decision) => decision.status === "no_match");

  const runId = `local_artwork_reconciliation_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runRoot = path.join(RECON_ROOT, runId);
  await mkdir(runRoot, { recursive: true });

  const applied: Array<{ album_id: string; canonical_cover_path: string; source_file: string }> = [];
  if (applyHighConfidence) {
    for (const decision of highConfidence) {
      if (!decision.selected_source_path || !decision.selected_file) continue;
      const ext = path.extname(decision.selected_file).replace(".", "") || "jpg";
      const albumDir = path.join(WORKSPACE_ROOT, "public/retroverse/covers", decision.album_id);
      await mkdir(albumDir, { recursive: true });
      const targetFilename = `${decision.album_id}__${slugify(decision.artist)}__${slugify(decision.title)}.${ext}`;
      const targetAbsPath = path.join(albumDir, targetFilename);
      await copyFile(decision.selected_source_path, targetAbsPath);

      const canonicalPath = `public/retroverse/covers/${decision.album_id}/${targetFilename}`;
      const rows = artworkByAlbumId.get(decision.album_id) ?? [];
      const targetRow = rows.find((row) => row.is_primary) ?? rows.find((row) => row.artwork_role === "primary") ?? rows[0];

      if (targetRow?.retroverse_album_artwork_id) {
        const { error } = await supabase
          .from("retroverse_album_artwork")
          .update({
            canonical_cover_path: canonicalPath,
            cover_source: "local_covers_master",
            artwork_status: "verified",
            artwork_role: "primary",
            is_primary: true,
          })
          .eq("retroverse_album_artwork_id", targetRow.retroverse_album_artwork_id);
        if (error) throw error;
      } else {
        const newArtworkId = `RVAW${String(nextArtworkOrdinal).padStart(6, "0")}`;
        nextArtworkOrdinal += 1;
        const { data: inserted, error } = await supabase
          .from("retroverse_album_artwork")
          .insert({
            retroverse_album_artwork_id: newArtworkId,
            retroverse_album_id: decision.album_id,
            retroverse_album_edition_id: null,
            artwork_role: "primary",
            is_primary: true,
            canonical_cover_path: canonicalPath,
            cover_source: "local_covers_master",
            artwork_status: "verified",
            width_px: null,
            height_px: null,
            notes: `Auto-reconciled from covers_master: ${decision.selected_file}`,
          })
          .select("retroverse_album_artwork_id")
          .single();
        if (error) throw error;
        artworkByAlbumId.set(decision.album_id, [
          ...(artworkByAlbumId.get(decision.album_id) ?? []),
          {
            retroverse_album_artwork_id: inserted.retroverse_album_artwork_id,
            retroverse_album_id: decision.album_id,
            canonical_cover_path: canonicalPath,
            is_primary: true,
            artwork_role: "primary",
          },
        ]);
      }

      applied.push({
        album_id: decision.album_id,
        canonical_cover_path: canonicalPath,
        source_file: decision.selected_file,
      });
    }
  }

  const summary = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    source_root: COVERS_MASTER_ROOT,
    local_archive: {
      total_image_files: localFiles.length,
      parse_stats: parseStats,
      extension_stats: extensionStats,
    },
    canonical_albums: albums.length,
    match_results: {
      high_confidence: highConfidence.length,
      medium_confidence: mediumConfidence.length,
      unresolved: unresolved.length,
    },
    high_confidence_queue: highConfidence,
    medium_confidence_queue: mediumConfidence,
    unresolved_queue: unresolved,
    applied: {
      enabled: applyHighConfidence,
      count: applied.length,
      rows: applied,
    },
  };

  const jsonPath = path.join(runRoot, "reconciliation_summary.json");
  const mdPath = path.join(runRoot, "reconciliation_summary.md");
  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const md = [
    `# Local Artwork Reconciliation ${runId}`,
    "",
    `- source root: ${COVERS_MASTER_ROOT}`,
    `- local image files: ${localFiles.length}`,
    `- parseable artist/title files: ${parseStats.artist_album_underscore + parseStats.artist_album_dash}`,
    `- canonical albums: ${albums.length}`,
    "",
    "## Matching queues",
    `- high confidence: ${highConfidence.length}`,
    `- medium confidence: ${mediumConfidence.length}`,
    `- unresolved: ${unresolved.length}`,
    "",
    "## Applied",
    `- apply-high-confidence: ${applyHighConfidence}`,
    `- applied rows: ${applied.length}`,
    "",
    "## Top high-confidence matches (first 20)",
    ...highConfidence.slice(0, 20).map((row) => `- ${row.album_id} | ${row.artist} - ${row.title} -> ${row.selected_file}`),
    "",
    "## Top unresolved (first 20)",
    ...unresolved.slice(0, 20).map((row) => `- ${row.album_id} | ${row.artist} - ${row.title}`),
  ].join("\n");
  await writeFile(mdPath, md, "utf8");

  console.log(`reconciliation_json=${jsonPath}`);
  console.log(`reconciliation_md=${mdPath}`);
  console.log(`high_confidence=${highConfidence.length}`);
  console.log(`medium_confidence=${mediumConfidence.length}`);
  console.log(`unresolved=${unresolved.length}`);
  console.log(`applied=${applied.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
