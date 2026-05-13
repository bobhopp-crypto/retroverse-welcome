import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const INTEGRITY_ROOT =
  process.env.RETROVERSE_AUDIT_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/archive-integrity";
const ENRICHMENT_ROOT =
  process.env.RETROVERSE_ENRICHMENT_LOG_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA/logs/archive-enrichment";

type IntegritySnapshot = {
  generated_at: string;
  counts?: {
    artists: number;
    albums: number;
    tracks: number;
    eras: number;
  };
  sequencing_integrity?: {
    authoritative?: { count: number; pct: number };
    fallback?: { count: number; pct: number };
    partial?: { count: number; pct: number };
    no_usable?: { count: number; pct: number };
  };
  artwork_integrity?: {
    canonical?: { count: number; pct: number };
    fallback?: { count: number; pct: number };
    broken?: { count: number; pct: number };
    missing?: { count: number; pct: number };
  };
  traversal_integrity?: {
    artists_with_connected_albums?: { count: number; pct: number };
    albums_with_connected_tracks?: { count: number; pct: number };
    tracks_with_connected_eras?: { count: number; pct: number };
  };
  canonical_confidence?: {
    weak_slug_matches?: { count: number };
    unresolved_era_references?: {
      artists: number;
      albums: number;
      songs: number;
    };
  };
};

type EnrichmentSnapshot = {
  generated_at: string;
  counts?: {
    artwork_queue_items: number;
    era_reference_queue_items: number;
    slug_cleanup_items: number;
  };
};

function runId(): string {
  return `ops_progress_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

function delta(current: number, previous: number): string {
  const d = current - previous;
  if (d === 0) return "0";
  return d > 0 ? `+${d}` : `${d}`;
}

function deltaPct(current: number, previous: number): string {
  const d = Number((current - previous).toFixed(2));
  if (d === 0) return "0.00";
  return d > 0 ? `+${d.toFixed(2)}` : d.toFixed(2);
}

async function latestFiles(root: string, prefix: string): Promise<string[]> {
  const files = await readdir(root, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(".json"))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => a.localeCompare(b))
    .slice(-2);
}

async function readJson<T>(absPath: string): Promise<T> {
  const raw = await readFile(absPath, "utf8");
  return JSON.parse(raw) as T;
}

async function main() {
  await mkdir(ENRICHMENT_ROOT, { recursive: true });
  const integrityFiles = await latestFiles(INTEGRITY_ROOT, "archive_integrity_");
  const enrichmentFiles = await latestFiles(ENRICHMENT_ROOT, "archive_enrichment_");

  if (integrityFiles.length === 0 && enrichmentFiles.length === 0) {
    throw new Error(
      `No archive integrity or enrichment JSON snapshots found.\nRun:\n- npm run audit:archive-integrity\n- npm run queue:archive-enrichment`,
    );
  }

  const currentIntegrity = integrityFiles.length > 0 ? await readJson<IntegritySnapshot>(integrityFiles[integrityFiles.length - 1]) : null;
  const previousIntegrity = integrityFiles.length > 1 ? await readJson<IntegritySnapshot>(integrityFiles[integrityFiles.length - 2]) : null;
  const currentEnrichment =
    enrichmentFiles.length > 0 ? await readJson<EnrichmentSnapshot>(enrichmentFiles[enrichmentFiles.length - 1]) : null;
  const previousEnrichment =
    enrichmentFiles.length > 1 ? await readJson<EnrichmentSnapshot>(enrichmentFiles[enrichmentFiles.length - 2]) : null;

  const unresolvedEraTotalCurrent =
    (currentIntegrity?.canonical_confidence?.unresolved_era_references?.artists ?? 0) +
    (currentIntegrity?.canonical_confidence?.unresolved_era_references?.albums ?? 0) +
    (currentIntegrity?.canonical_confidence?.unresolved_era_references?.songs ?? 0);
  const unresolvedEraTotalPrevious =
    (previousIntegrity?.canonical_confidence?.unresolved_era_references?.artists ?? 0) +
    (previousIntegrity?.canonical_confidence?.unresolved_era_references?.albums ?? 0) +
    (previousIntegrity?.canonical_confidence?.unresolved_era_references?.songs ?? 0);

  const summary = {
    generated_at: new Date().toISOString(),
    current: {
      integrity_file: currentIntegrity ? integrityFiles[integrityFiles.length - 1] : null,
      enrichment_file: currentEnrichment ? enrichmentFiles[enrichmentFiles.length - 1] : null,
      artwork_canonical_pct: currentIntegrity?.artwork_integrity?.canonical?.pct ?? 0,
      artwork_missing_count: currentIntegrity?.artwork_integrity?.missing?.count ?? 0,
      artwork_broken_count: currentIntegrity?.artwork_integrity?.broken?.count ?? 0,
      weak_slug_matches: currentIntegrity?.canonical_confidence?.weak_slug_matches?.count ?? 0,
      unresolved_era_references_total: unresolvedEraTotalCurrent,
      traversal_artist_album_pct: currentIntegrity?.traversal_integrity?.artists_with_connected_albums?.pct ?? 0,
      traversal_album_track_pct: currentIntegrity?.traversal_integrity?.albums_with_connected_tracks?.pct ?? 0,
      traversal_track_era_pct: currentIntegrity?.traversal_integrity?.tracks_with_connected_eras?.pct ?? 0,
      artwork_queue_items: currentEnrichment?.counts?.artwork_queue_items ?? 0,
      era_reference_queue_items: currentEnrichment?.counts?.era_reference_queue_items ?? 0,
      slug_cleanup_items: currentEnrichment?.counts?.slug_cleanup_items ?? 0,
    },
    delta_from_previous: {
      artwork_canonical_pct: deltaPct(
        currentIntegrity?.artwork_integrity?.canonical?.pct ?? 0,
        previousIntegrity?.artwork_integrity?.canonical?.pct ?? 0,
      ),
      artwork_missing_count: delta(
        currentIntegrity?.artwork_integrity?.missing?.count ?? 0,
        previousIntegrity?.artwork_integrity?.missing?.count ?? 0,
      ),
      artwork_broken_count: delta(
        currentIntegrity?.artwork_integrity?.broken?.count ?? 0,
        previousIntegrity?.artwork_integrity?.broken?.count ?? 0,
      ),
      weak_slug_matches: delta(
        currentIntegrity?.canonical_confidence?.weak_slug_matches?.count ?? 0,
        previousIntegrity?.canonical_confidence?.weak_slug_matches?.count ?? 0,
      ),
      unresolved_era_references_total: delta(unresolvedEraTotalCurrent, unresolvedEraTotalPrevious),
      artwork_queue_items: delta(
        currentEnrichment?.counts?.artwork_queue_items ?? 0,
        previousEnrichment?.counts?.artwork_queue_items ?? 0,
      ),
      era_reference_queue_items: delta(
        currentEnrichment?.counts?.era_reference_queue_items ?? 0,
        previousEnrichment?.counts?.era_reference_queue_items ?? 0,
      ),
      slug_cleanup_items: delta(
        currentEnrichment?.counts?.slug_cleanup_items ?? 0,
        previousEnrichment?.counts?.slug_cleanup_items ?? 0,
      ),
    },
  };

  const id = runId();
  const jsonPath = path.join(ENRICHMENT_ROOT, `${id}.json`);
  const mdPath = path.join(ENRICHMENT_ROOT, `${id}.md`);
  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");

  const md = [
    `# Retroverse Enrichment Progress ${id}`,
    "",
    `Generated: ${summary.generated_at}`,
    "",
    "## Current Snapshot",
    `- artwork canonical %: ${summary.current.artwork_canonical_pct}`,
    `- artwork missing: ${summary.current.artwork_missing_count}`,
    `- artwork broken: ${summary.current.artwork_broken_count}`,
    `- weak slug matches: ${summary.current.weak_slug_matches}`,
    `- unresolved era references (total): ${summary.current.unresolved_era_references_total}`,
    `- traversal artist->album %: ${summary.current.traversal_artist_album_pct}`,
    `- traversal album->track %: ${summary.current.traversal_album_track_pct}`,
    `- traversal track->era %: ${summary.current.traversal_track_era_pct}`,
    `- artwork queue: ${summary.current.artwork_queue_items}`,
    `- era-reference queue: ${summary.current.era_reference_queue_items}`,
    `- slug-cleanup queue: ${summary.current.slug_cleanup_items}`,
    "",
    "## Delta vs Previous Snapshot",
    `- artwork canonical %: ${summary.delta_from_previous.artwork_canonical_pct}`,
    `- artwork missing: ${summary.delta_from_previous.artwork_missing_count}`,
    `- artwork broken: ${summary.delta_from_previous.artwork_broken_count}`,
    `- weak slug matches: ${summary.delta_from_previous.weak_slug_matches}`,
    `- unresolved era references (total): ${summary.delta_from_previous.unresolved_era_references_total}`,
    `- artwork queue: ${summary.delta_from_previous.artwork_queue_items}`,
    `- era-reference queue: ${summary.delta_from_previous.era_reference_queue_items}`,
    `- slug-cleanup queue: ${summary.delta_from_previous.slug_cleanup_items}`,
    "",
    `JSON summary: ${jsonPath}`,
  ].join("\n");

  await writeFile(mdPath, `${md}\n`, "utf8");
  console.log(`ops_progress_json=${jsonPath}`);
  console.log(`ops_progress_md=${mdPath}`);
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(message);
  process.exitCode = 1;
});

