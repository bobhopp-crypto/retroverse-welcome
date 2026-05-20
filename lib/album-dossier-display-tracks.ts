import type { AlbumDossierTrack } from "@/lib/album-dossier-schema";
import {
  aggregateAcousticMeans,
  applyRumoursStemAlias,
  groupTracksByCanonicalStem,
  splitCanonicalStem,
  type AggregatedAcousticProfile,
} from "@/lib/canonical-acoustic-aggregate";
import { getCanonicalAlbumSequence, type CanonicalAlbumSequence } from "@/lib/canonical-album-sequences";
import { RUMOURS_DOSSIER_PROOF_RVAL } from "@/lib/rumours-proof-poc";
import { curateTrackSignals } from "@/lib/signal-curation";

export type DossierDisplayTrack = AlbumDossierTrack & {
  canonicalRefLabel?: string;
  canonicalSequenceLabel?: string;
};

export type DossierTrackRow = {
  track: DossierDisplayTrack;
  profile: AggregatedAcousticProfile;
  position: number | string;
  retroverseDial: number;
};

function normalizeCanonicalTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\s*[-–—]\s*.*\bremaster(?:ed)?\b.*$/i, "")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveCanonicalSequenceTracks(
  sequence: CanonicalAlbumSequence,
  sourceTracks: AlbumDossierTrack[],
): DossierDisplayTrack[] {
  const sourceByTitle = new Map<string, AlbumDossierTrack>();
  const sourceByRawTitle = new Map<string, AlbumDossierTrack>();
  for (const track of sourceTracks) {
    const key = normalizeCanonicalTitle(track.title);
    if (key && !sourceByTitle.has(key)) sourceByTitle.set(key, track);
    sourceByRawTitle.set(track.title.trim(), track);
  }

  return sequence.tracks.map((track) => {
    const source = track.source_title
      ? sourceByRawTitle.get(track.source_title.trim()) ??
        sourceByTitle.get(normalizeCanonicalTitle(track.source_title))
      : sourceByTitle.get(normalizeCanonicalTitle(track.canonical_title));

    return {
      ...source,
      title: track.canonical_title,
      duration_ms: track.duration_ms ?? source?.duration_ms ?? null,
      canonicalRefLabel: sequence.source_label,
      canonicalSequenceLabel:
        track.side_label && track.side_position != null
          ? `${track.side_label}${track.side_position}`
          : String(track.global_position),
    };
  });
}

function trackPosition(track: DossierDisplayTrack, fallbackIndex: number): number | string {
  if (track.canonicalSequenceLabel) return track.canonicalSequenceLabel;
  const pos = track.musicbrainz?.position;
  return typeof pos === "number" && Number.isFinite(pos) && pos > 0 ? pos : fallbackIndex + 1;
}

function retroverseDialFromTrack(track: AlbumDossierTrack, profile: AggregatedAcousticProfile): number {
  if (track.retroverse_score != null && Number.isFinite(track.retroverse_score)) {
    return Math.min(99, Math.max(0, Math.round(track.retroverse_score)));
  }
  const pts: number[] = [];
  for (const n of [profile.energy, profile.valence, profile.danceability, profile.liveness]) {
    if (n != null && Number.isFinite(n)) pts.push(n);
  }
  if (!pts.length) return 0;
  return Math.min(99, Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 100));
}

function profileForTrack(
  track: DossierDisplayTrack,
  grouped: Map<string, { profile: AggregatedAcousticProfile }>,
  stemAlias?: (stem: string) => string,
): AggregatedAcousticProfile {
  let stem = splitCanonicalStem(track.title);
  if (stemAlias) stem = stemAlias(stem);
  const bucket = grouped.get(stem.trim().toLowerCase());
  if (bucket) return bucket.profile;
  return aggregateAcousticMeans([track]);
}

/** Original-album track rows only — canonical sequence when present, else curated primary stems. */
export function buildDossierTrackRows(
  albumId: string,
  sourceTracks: AlbumDossierTrack[],
): DossierTrackRow[] {
  const stemAlias = albumId === RUMOURS_DOSSIER_PROOF_RVAL ? applyRumoursStemAlias : undefined;
  const grouped = groupTracksByCanonicalStem(sourceTracks, stemAlias);
  const sequence = getCanonicalAlbumSequence(albumId);

  let displayTracks: DossierDisplayTrack[];

  if (sequence) {
    displayTracks = resolveCanonicalSequenceTracks(sequence, sourceTracks);
  } else {
    const curated = curateTrackSignals(sourceTracks).filter((t) => t.signalTier === "primary");
    const seen = new Set<string>();
    displayTracks = [];
    for (const track of curated) {
      let stem = splitCanonicalStem(track.title);
      if (stemAlias) stem = stemAlias(stem);
      const key = stem.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      displayTracks.push({ ...track, title: stem.trim() || track.title });
    }
  }

  return displayTracks.map((track, i) => {
    const profile = profileForTrack(track, grouped, stemAlias);
    return {
      track,
      profile,
      position: trackPosition(track, i),
      retroverseDial: retroverseDialFromTrack(track, profile),
    };
  });
}
