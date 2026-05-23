import { fuzzyScoreParts } from "@/lib/relationship-workspace/fuzzy";
import { trackPlaybackKey } from "@/lib/legacy-playback/playback-key";

export type CanonicalTrackMatchRow = {
  retroverse_track_id: string;
  canonical_title: string;
  artist_name: string;
  release_year: number | null;
};

export type VdjInstanceMatchInput = {
  artist_text: string;
  title_text: string;
  duration_seconds: number | null;
  file_path: string;
};

const STRONG_SCORE = 70;
const DURATION_TOLERANCE_SEC = 8;

function durationBoost(
  vdjDuration: number | null,
  trackYear: number | null,
  vdjYear: string,
): number {
  if (vdjDuration == null || vdjDuration <= 0) return 0;
  const year = Number.parseInt(vdjYear, 10);
  if (Number.isFinite(year) && trackYear != null && Math.abs(year - trackYear) <= 1) return 4;
  return 0;
}

export function buildTrackMatchIndex(rows: CanonicalTrackMatchRow[]): Map<string, CanonicalTrackMatchRow[]> {
  const index = new Map<string, CanonicalTrackMatchRow[]>();
  for (const row of rows) {
    const key = trackPlaybackKey(row.artist_name, row.canonical_title);
    if (!key) continue;
    const bucket = index.get(key) ?? [];
    bucket.push(row);
    index.set(key, bucket);
  }
  return index;
}

export function matchVdjInstanceToTrack(
  input: VdjInstanceMatchInput,
  index: Map<string, CanonicalTrackMatchRow[]>,
  allTracks: CanonicalTrackMatchRow[],
): { retroverse_track_id: string; match_confidence: number; match_method: string } | null {
  const exactKey = trackPlaybackKey(input.artist_text, input.title_text);
  const exactBucket = exactKey ? index.get(exactKey) : undefined;
  if (exactBucket?.length === 1) {
    return {
      retroverse_track_id: exactBucket[0]!.retroverse_track_id,
      match_confidence: 0.98,
      match_method: "playback_key_exact",
    };
  }
  if (exactBucket && exactBucket.length > 1 && input.duration_seconds) {
    const pick = exactBucket[0]!;
    return {
      retroverse_track_id: pick.retroverse_track_id,
      match_confidence: 0.85,
      match_method: "playback_key_ambiguous_first",
    };
  }

  const hay = `${input.artist_text} ${input.title_text} ${input.file_path}`;
  let best: { row: CanonicalTrackMatchRow; score: number; reason: string } | null = null;

  for (const row of allTracks) {
    const { score, reason } = fuzzyScoreParts(hay, row.artist_name, row.canonical_title);
    const boosted = score + durationBoost(input.duration_seconds, row.release_year, "");
    if (!best || boosted > best.score) {
      best = { row, score: boosted, reason };
    }
  }

  if (!best || best.score < STRONG_SCORE) return null;

  const confidence = Math.min(0.97, 0.55 + best.score / 200);
  return {
    retroverse_track_id: best.row.retroverse_track_id,
    match_confidence: Number(confidence.toFixed(4)),
    match_method: `fuzzy:${best.reason}`,
  };
}

export function mediaTypeFromPath(filePath: string): "video" | "audio" | "image" | "other" {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  if (["mp4", "mov", "mkv", "avi", "webm", "m4v"].includes(ext)) return "video";
  if (["mp3", "wav", "flac", "aac", "m4a", "ogg", "aiff"].includes(ext)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp"].includes(ext)) return "image";
  return "other";
}
