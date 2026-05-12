import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import {
  getArtworkState,
  loadArtworkStateRegistry,
  type LivingArtworkState,
} from "@/lib/artwork-living-archive";

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
  tier: "high" | "medium" | "unresolved";
  best_candidate: Candidate | null;
  candidates?: Candidate[];
  download_status: "downloaded" | "failed" | "not_attempted";
  staged_file: string | null;
  query_used_for_best?: string | null;
  normalized_query?: string | null;
  top_candidate_rejection_reason?: string | null;
  confidence_blockers?: string[];
  pattern_category?: string;
  before_patterns?: string[];
};

type AcquisitionSummary = {
  run_id: string;
  rows: AcquisitionRow[];
};

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
  retroverse_album_id: string;
  canonical_cover_path: string | null;
  is_primary?: boolean;
  artwork_role?: string | null;
  cover_source?: string | null;
  artwork_status?: string | null;
};

export type StagedDecision = "approve" | "reject" | "defer";

export type WorkbenchCandidate = {
  albumId: string;
  title: string;
  artist: string;
  year: number | null;
  state: "canonical" | "staged-high" | "staged-medium" | "unresolved";
  artworkState: LivingArtworkState;
  provisional: boolean;
  confidence: number | null;
  sourceArtist: string | null;
  sourceCollection: string | null;
  sourceReleaseDate: string | null;
  stagedFilePath: string | null;
  candidateSource: string | null;
  runId: string | null;
  decision: StagedDecision;
  queryUsed: string | null;
  normalizedQuery: string | null;
  topRejected: Array<{ name: string; score: number }>;
  unresolvedReasons: string[];
  patternCategory: string | null;
  topRejectionReason: string | null;
  appliedAt: string | null;
};

export type WorkbenchData = {
  canonical: WorkbenchCandidate[];
  stagedHigh: WorkbenchCandidate[];
  stagedMedium: WorkbenchCandidate[];
  unresolved: WorkbenchCandidate[];
  decisionsPath: string;
  runs: {
    acquisitionRunId: string | null;
    refinementRunId: string | null;
  };
};

const ITUNES_PASS_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass";
const WORKBENCH_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/workbench";
export const DECISIONS_FILE = path.join(WORKBENCH_ROOT, "decisions.json");

function withFallbackDecision(raw: unknown): StagedDecision {
  if (raw === "approve" || raw === "reject" || raw === "defer") return raw;
  return "defer";
}

async function ensureDecisionsFile(): Promise<Record<string, { decision: StagedDecision; notes: string; updated_at: string }>> {
  await mkdir(WORKBENCH_ROOT, { recursive: true });
  try {
    const raw = await readFile(DECISIONS_FILE, "utf8");
    return JSON.parse(raw) as Record<string, { decision: StagedDecision; notes: string; updated_at: string }>;
  } catch {
    return {};
  }
}

async function latestDir(root: string, prefix: string): Promise<string | null> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const dir = entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))[0];
    return dir ? path.join(root, dir) : null;
  } catch {
    return null;
  }
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toPublicCoverSrc(canonicalCoverPath: string): string {
  return canonicalCoverPathToUrl(canonicalCoverPath) ?? "";
}

export async function loadWorkbenchData(): Promise<WorkbenchData> {
  const decisions = await ensureDecisionsFile();
  const livingRegistry = await loadArtworkStateRegistry();

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase environment variables for artwork workbench.");
  }
  const supabase = createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [albumsResult, artistsResult, artworkResult] = await Promise.all([
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase.from("retroverse_album_artwork").select("retroverse_album_id, canonical_cover_path, is_primary, artwork_role, cover_source, artwork_status"),
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
  const artworkByAlbum = new Map<string, ArtworkRow[]>();
  for (const row of artworkRows) {
    artworkByAlbum.set(row.retroverse_album_id, [...(artworkByAlbum.get(row.retroverse_album_id) ?? []), row]);
  }

  const canonical: WorkbenchCandidate[] = [];
  const canonicalByAlbum = new Map<string, WorkbenchCandidate>();
  for (const album of albums) {
    const rows = artworkByAlbum.get(album.retroverse_album_id) ?? [];
    const canonicalRow =
      rows.find((row) => row.is_primary && row.canonical_cover_path) ??
      rows.find((row) => row.artwork_role === "primary" && row.canonical_cover_path) ??
      rows.find((row) => row.canonical_cover_path);
    if (!canonicalRow?.canonical_cover_path) continue;
    const candidate: WorkbenchCandidate = {
      albumId: album.retroverse_album_id,
      title: album.canonical_album_title,
      artist: artistById.get(album.retroverse_artist_id) ?? "Unknown artist",
      year: album.release_year,
      state: "canonical",
      artworkState:
        getArtworkState(livingRegistry, album.retroverse_album_id)?.state ??
        (canonicalRow.artwork_status === "pending"
          ? "needs_review"
          : canonicalRow.artwork_status === "rejected"
            ? "low_confidence"
            : "canonical_verified"),
      provisional: getArtworkState(livingRegistry, album.retroverse_album_id)?.provisional ?? false,
      confidence: null,
      sourceArtist: null,
      sourceCollection: null,
      sourceReleaseDate: null,
      stagedFilePath: toPublicCoverSrc(canonicalRow.canonical_cover_path),
      candidateSource: canonicalRow.cover_source ?? null,
      runId: null,
      decision: "defer",
      queryUsed: null,
      normalizedQuery: getArtworkState(livingRegistry, album.retroverse_album_id)?.normalized_query ?? null,
      topRejected: [],
      unresolvedReasons: [],
      patternCategory: getArtworkState(livingRegistry, album.retroverse_album_id)?.state ?? null,
      topRejectionReason: null,
      appliedAt: getArtworkState(livingRegistry, album.retroverse_album_id)?.applied_at ?? null,
    };
    canonical.push(candidate);
    canonicalByAlbum.set(candidate.albumId, candidate);
  }

  const acquisitionRunDir = await latestDir(ITUNES_PASS_ROOT, "itunes_canonical_pass_");
  const refinementRunDir = await latestDir(ITUNES_PASS_ROOT, "itunes_unresolved_refine_");
  const acquisitionSummary = acquisitionRunDir
    ? await readJson<AcquisitionSummary>(path.join(acquisitionRunDir, "metadata", "itunes_acquisition_summary.json"))
    : null;
  const refinementSummary = refinementRunDir
    ? await readJson<AcquisitionSummary>(path.join(refinementRunDir, "metadata", "unresolved_refinement_summary.json"))
    : null;

  const stagedHighByAlbum = new Map<string, WorkbenchCandidate>();
  const stagedMediumByAlbum = new Map<string, WorkbenchCandidate>();

  function addStagedRows(summary: AcquisitionSummary | null, runId: string | null) {
    if (!summary) return;
    for (const row of summary.rows) {
      if (row.download_status !== "downloaded" || !row.staged_file) continue;
      if (canonicalByAlbum.has(row.album_id)) continue;

      const key = `${runId ?? "unknown"}:${row.album_id}`;
      const decision = withFallbackDecision(decisions[key]?.decision);
      const candidate: WorkbenchCandidate = {
        albumId: row.album_id,
        title: row.title,
        artist: row.artist,
        year: row.release_year,
        state: row.tier === "high" ? "staged-high" : row.tier === "medium" ? "staged-medium" : "unresolved",
        artworkState:
          getArtworkState(livingRegistry, row.album_id)?.state ??
          (row.tier === "high"
            ? "provisional"
            : row.tier === "medium"
              ? "needs_review"
              : row.best_candidate
                ? "provisional"
                : "unresolved"),
        provisional: getArtworkState(livingRegistry, row.album_id)?.provisional ?? false,
        confidence: row.best_candidate?.score ?? null,
        sourceArtist: row.best_candidate?.artist_name ?? null,
        sourceCollection: row.best_candidate?.collection_name ?? null,
        sourceReleaseDate: row.best_candidate?.release_date ?? null,
        stagedFilePath: row.staged_file,
        candidateSource: row.best_candidate?.artwork_url_600 ?? null,
        runId,
        decision,
        queryUsed: row.query_used_for_best ?? null,
        normalizedQuery: row.normalized_query ?? null,
        topRejected: (row.candidates ?? [])
          .filter(
            (candidate) =>
              candidate.collection_name !== row.best_candidate?.collection_name ||
              candidate.artist_name !== row.best_candidate?.artist_name,
          )
          .slice(0, 3)
          .map((candidate) => ({
            name: `${candidate.artist_name} - ${candidate.collection_name}`,
            score: candidate.score,
          })),
        unresolvedReasons: [],
        patternCategory: null,
        topRejectionReason: null,
        appliedAt: getArtworkState(livingRegistry, row.album_id)?.applied_at ?? null,
      };
      if (candidate.state === "staged-high") stagedHighByAlbum.set(candidate.albumId, candidate);
      if (candidate.state === "staged-medium") stagedMediumByAlbum.set(candidate.albumId, candidate);
    }
  }

  addStagedRows(acquisitionSummary, acquisitionSummary?.run_id ?? null);
  addStagedRows(refinementSummary, refinementSummary?.run_id ?? null);

  const unresolved: WorkbenchCandidate[] = [];
  const unresolvedSource = refinementSummary ?? acquisitionSummary;
  if (unresolvedSource) {
    for (const row of unresolvedSource.rows.filter((row) => row.tier === "unresolved")) {
      if (canonicalByAlbum.has(row.album_id)) continue;
      unresolved.push({
        albumId: row.album_id,
        title: row.title,
        artist: row.artist,
        year: row.release_year,
        state: "unresolved",
        artworkState:
          getArtworkState(livingRegistry, row.album_id)?.state ??
          (row.best_candidate ? "provisional" : "unresolved"),
        provisional: getArtworkState(livingRegistry, row.album_id)?.provisional ?? Boolean(row.best_candidate),
        confidence: row.best_candidate?.score ?? null,
        sourceArtist: row.best_candidate?.artist_name ?? null,
        sourceCollection: row.best_candidate?.collection_name ?? null,
        sourceReleaseDate: row.best_candidate?.release_date ?? null,
        stagedFilePath: null,
        candidateSource: row.best_candidate?.artwork_url_600 ?? null,
        runId: unresolvedSource.run_id,
        decision: "defer",
        queryUsed: row.query_used_for_best ?? null,
        normalizedQuery: row.normalized_query ?? null,
        topRejected: (row.candidates ?? [])
          .slice(0, 3)
          .map((candidate) => ({
            name: `${candidate.artist_name} - ${candidate.collection_name}`,
            score: candidate.score,
          })),
        unresolvedReasons: [...(row.confidence_blockers ?? []), ...(row.before_patterns ?? [])],
        patternCategory: row.pattern_category ?? null,
        topRejectionReason: row.top_candidate_rejection_reason ?? null,
        appliedAt: getArtworkState(livingRegistry, row.album_id)?.applied_at ?? null,
      });
    }
  }

  const sortFn = (a: WorkbenchCandidate, b: WorkbenchCandidate) =>
    a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title) || a.albumId.localeCompare(b.albumId);

  return {
    canonical: canonical.sort(sortFn),
    stagedHigh: [...stagedHighByAlbum.values()].sort(sortFn),
    stagedMedium: [...stagedMediumByAlbum.values()].sort(sortFn),
    unresolved: unresolved.sort(sortFn),
    decisionsPath: DECISIONS_FILE,
    runs: {
      acquisitionRunId: acquisitionSummary?.run_id ?? null,
      refinementRunId: refinementSummary?.run_id ?? null,
    },
  };
}
