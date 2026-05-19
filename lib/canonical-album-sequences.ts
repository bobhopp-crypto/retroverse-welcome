import { readFileSync } from "node:fs";
import path from "node:path";

export type CanonicalAlbumTrack = {
  global_position: number;
  side_label: string | null;
  side_position: number | null;
  canonical_title: string;
  duration_ms: number | null;
  canonical_edition_flag: string;
  source_title?: string;
};

export type CanonicalAlbumSequence = {
  album_id: string;
  artist: string;
  album: string;
  source_label: string;
  source_note: string;
  canonical_edition: string;
  tracks: CanonicalAlbumTrack[];
};

export type CanonicalAlbumSequenceBundle = {
  version: number;
  generated_at: string;
  description?: string;
  sequences: Record<string, CanonicalAlbumSequence>;
};

let cached: CanonicalAlbumSequenceBundle | null = null;
let loadAttempted = false;

function isTrack(value: unknown): value is CanonicalAlbumTrack {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<CanonicalAlbumTrack>;
  return (
    typeof row.global_position === "number" &&
    typeof row.canonical_title === "string" &&
    row.canonical_title.trim().length > 0 &&
    (row.duration_ms == null || typeof row.duration_ms === "number")
  );
}

function normalizeSequence(sequence: CanonicalAlbumSequence): CanonicalAlbumSequence {
  return {
    ...sequence,
    tracks: sequence.tracks
      .filter(isTrack)
      .slice()
      .sort((a, b) => a.global_position - b.global_position),
  };
}

function loadBundle(): CanonicalAlbumSequenceBundle | null {
  if (loadAttempted) return cached;
  loadAttempted = true;

  const envPath = process.env.CANONICAL_ALBUM_SEQUENCES_PATH?.trim();
  const publicBundled = path.join(process.cwd(), "public", "data", "albums", "canonical-album-sequences.json");

  for (const p of [envPath, publicBundled]) {
    if (!p) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as CanonicalAlbumSequenceBundle;
      if (parsed?.sequences && typeof parsed.sequences === "object") {
        cached = {
          ...parsed,
          sequences: Object.fromEntries(
            Object.entries(parsed.sequences).map(([albumId, sequence]) => [
              albumId.toUpperCase(),
              normalizeSequence(sequence),
            ]),
          ),
        };
        return cached;
      }
    } catch {
      /* try next source */
    }
  }

  cached = null;
  return null;
}

export function getCanonicalAlbumSequence(albumId: string): CanonicalAlbumSequence | null {
  const id = albumId?.trim().toUpperCase();
  if (!id || !/^RVAL\d{6}$/.test(id)) return null;
  return loadBundle()?.sequences[id] ?? null;
}
