import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type LivingArtworkState =
  | "canonical_verified"
  | "provisional"
  | "low_confidence"
  | "unresolved"
  | "needs_review"
  | "manually_corrected";

export type ArtworkStateHistoryEvent = {
  at: string;
  action:
    | "auto_apply_high"
    | "auto_apply_medium"
    | "approve"
    | "reject"
    | "clear_artwork"
    | "replace_artwork"
    | "mark_verified"
    | "mark_needs_review"
    | "provisional_candidate"
    | "unresolved_marker";
  actor: "system" | "curator";
  previous_state: LivingArtworkState | null;
  next_state: LivingArtworkState;
  confidence_score: number | null;
  provenance_source: string | null;
  run_id: string | null;
  notes: string | null;
  db_snapshot_before?: Record<string, unknown> | null;
  db_snapshot_after?: Record<string, unknown> | null;
};

export type ArtworkStateRecord = {
  album_id: string;
  state: LivingArtworkState;
  confidence_score: number | null;
  provisional: boolean;
  provenance_source: string | null;
  provenance_run_id: string | null;
  candidate_artist: string | null;
  candidate_collection: string | null;
  candidate_release_date: string | null;
  candidate_artwork_url: string | null;
  staged_file: string | null;
  query_used: string | null;
  normalized_query: string | null;
  applied_at: string | null;
  updated_at: string;
  history: ArtworkStateHistoryEvent[];
};

type ArtworkStateRegistry = {
  generated_at: string;
  updated_at: string;
  records: Record<string, ArtworkStateRecord>;
};

export const ARTWORK_STATE_REGISTRY_PATH =
  "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/workbench/artwork_state_registry.json";

function emptyRegistry(): ArtworkStateRegistry {
  const now = new Date().toISOString();
  return {
    generated_at: now,
    updated_at: now,
    records: {},
  };
}

export async function loadArtworkStateRegistry(): Promise<ArtworkStateRegistry> {
  try {
    const raw = await readFile(ARTWORK_STATE_REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw) as ArtworkStateRegistry;
    if (!parsed.records) return emptyRegistry();
    return parsed;
  } catch {
    return emptyRegistry();
  }
}

export async function saveArtworkStateRegistry(registry: ArtworkStateRegistry): Promise<void> {
  const now = new Date().toISOString();
  const next: ArtworkStateRegistry = {
    ...registry,
    updated_at: now,
  };
  await mkdir(path.dirname(ARTWORK_STATE_REGISTRY_PATH), { recursive: true });
  await writeFile(ARTWORK_STATE_REGISTRY_PATH, JSON.stringify(next, null, 2), "utf8");
}

export function getArtworkState(
  registry: ArtworkStateRegistry,
  albumId: string,
): ArtworkStateRecord | null {
  return registry.records[albumId] ?? null;
}

export function upsertArtworkState(
  registry: ArtworkStateRegistry,
  input: {
    albumId: string;
    nextState: LivingArtworkState;
    confidenceScore?: number | null;
    provisional?: boolean;
    provenanceSource?: string | null;
    provenanceRunId?: string | null;
    candidateArtist?: string | null;
    candidateCollection?: string | null;
    candidateReleaseDate?: string | null;
    candidateArtworkUrl?: string | null;
    stagedFile?: string | null;
    queryUsed?: string | null;
    normalizedQuery?: string | null;
    appliedAt?: string | null;
    action: ArtworkStateHistoryEvent["action"];
    actor: ArtworkStateHistoryEvent["actor"];
    notes?: string | null;
    dbSnapshotBefore?: Record<string, unknown> | null;
    dbSnapshotAfter?: Record<string, unknown> | null;
  },
): ArtworkStateRecord {
  const now = new Date().toISOString();
  const previous = registry.records[input.albumId] ?? null;
  const next: ArtworkStateRecord = {
    album_id: input.albumId,
    state: input.nextState,
    confidence_score: input.confidenceScore ?? previous?.confidence_score ?? null,
    provisional: input.provisional ?? previous?.provisional ?? false,
    provenance_source: input.provenanceSource ?? previous?.provenance_source ?? null,
    provenance_run_id: input.provenanceRunId ?? previous?.provenance_run_id ?? null,
    candidate_artist: input.candidateArtist ?? previous?.candidate_artist ?? null,
    candidate_collection: input.candidateCollection ?? previous?.candidate_collection ?? null,
    candidate_release_date: input.candidateReleaseDate ?? previous?.candidate_release_date ?? null,
    candidate_artwork_url: input.candidateArtworkUrl ?? previous?.candidate_artwork_url ?? null,
    staged_file: input.stagedFile ?? previous?.staged_file ?? null,
    query_used: input.queryUsed ?? previous?.query_used ?? null,
    normalized_query: input.normalizedQuery ?? previous?.normalized_query ?? null,
    applied_at: input.appliedAt ?? previous?.applied_at ?? null,
    updated_at: now,
    history: [
      ...(previous?.history ?? []),
      {
        at: now,
        action: input.action,
        actor: input.actor,
        previous_state: previous?.state ?? null,
        next_state: input.nextState,
        confidence_score: input.confidenceScore ?? previous?.confidence_score ?? null,
        provenance_source: input.provenanceSource ?? previous?.provenance_source ?? null,
        run_id: input.provenanceRunId ?? previous?.provenance_run_id ?? null,
        notes: input.notes ?? null,
        db_snapshot_before: input.dbSnapshotBefore ?? null,
        db_snapshot_after: input.dbSnapshotAfter ?? null,
      },
    ],
  };
  registry.records[input.albumId] = next;
  registry.updated_at = now;
  return next;
}
