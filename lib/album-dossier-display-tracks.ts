import type { AlbumDossierTrack } from "@/lib/album-dossier-schema";
import {
  aggregateAcousticMeans,
  applyRumoursStemAlias,
  groupTracksByCanonicalStem,
  splitCanonicalStem,
  type AggregatedAcousticProfile,
} from "@/lib/canonical-acoustic-aggregate";
import { getCanonicalAlbumSequence, type CanonicalAlbumSequence } from "@/lib/canonical-album-sequences";
import {
  getDossierMusicBrainzSidecar,
  type DossierMbSidecarAlbum,
  type DossierMbSidecarTrack,
} from "@/lib/load-dossier-musicbrainz-sidecar";
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

const HARD_POLLUTED_ACOUSTIC_ROW =
  /\b(2008|25th|anniversary|interview|voice[- ]?over|excerpt|karaoke|quincy|carousel|for all time|bonus|deluxe|rough|outtake|sessions?|alternate|underground|home demo)\b/i;

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

    return enrichCanonicalDisplayTrack(track.canonical_title, track.global_position, source, {
      canonicalRefLabel: sequence.source_label,
      canonicalSequenceLabel:
        track.side_label && track.side_position != null
          ? `${track.side_label}${track.side_position}`
          : String(track.global_position),
      duration_ms: track.duration_ms ?? source?.duration_ms ?? null,
    });
  });
}

function scoreAcousticMatch(canonicalTitle: string, candidate: AlbumDossierTrack, expectedPosition?: number): number {
  const canonNorm = normalizeCanonicalTitle(canonicalTitle);
  const titleNorm = normalizeCanonicalTitle(candidate.title);
  const stemNorm = normalizeCanonicalTitle(splitCanonicalStem(candidate.title));
  let score = 0;

  if (titleNorm === canonNorm || stemNorm === canonNorm) score += 120;
  else if (titleNorm.startsWith(`${canonNorm} `) || stemNorm.startsWith(`${canonNorm} `)) score += 70;
  else if (canonNorm.length >= 4 && (titleNorm.includes(canonNorm) || stemNorm.includes(canonNorm))) score += 35;

  if (HARD_POLLUTED_ACOUSTIC_ROW.test(candidate.title)) score -= 120;
  else if (/\b(remix|remaster|demo|mix)\b/i.test(candidate.title) && stemNorm !== canonNorm) score -= 80;

  const mbPos = candidate.musicbrainz?.position;
  if (
    expectedPosition != null &&
    typeof mbPos === "number" &&
    Number.isFinite(mbPos) &&
    mbPos === expectedPosition
  ) {
    score += 45;
  }

  if (candidate.energy != null || candidate.valence != null) score += 5;

  return score;
}

function findAcousticEnrichment(
  canonicalTitle: string,
  sourceTracks: AlbumDossierTrack[],
  expectedPosition?: number,
): AlbumDossierTrack | undefined {
  let best: AlbumDossierTrack | undefined;
  let bestScore = 0;

  for (const candidate of sourceTracks) {
    const score = scoreAcousticMatch(canonicalTitle, candidate, expectedPosition);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 50 ? best : undefined;
}

function enrichCanonicalDisplayTrack(
  canonicalTitle: string,
  position: number,
  source: AlbumDossierTrack | undefined,
  extra: Partial<DossierDisplayTrack>,
): DossierDisplayTrack {
  const mbSlim = {
    ...(source?.musicbrainz ?? {}),
    position,
  };

  return {
    ...(source ?? {}),
    title: canonicalTitle,
    musicbrainz: mbSlim,
    duration_ms: extra.duration_ms ?? source?.duration_ms ?? null,
    ...extra,
  };
}

function resolveMusicBrainzSidecarTracks(
  sidecar: DossierMbSidecarAlbum,
  sourceTracks: AlbumDossierTrack[],
): DossierDisplayTrack[] {
  const ordered = [...sidecar.tracks].sort((a, b) => a.position - b.position);
  return ordered.map((row: DossierMbSidecarTrack) => {
    const source = findAcousticEnrichment(row.title, sourceTracks, row.position);
    return enrichCanonicalDisplayTrack(row.title, row.position, source, {
      canonicalRefLabel: "musicbrainz_cache",
      canonicalSequenceLabel: String(row.position),
    });
  });
}

function resolveMusicBrainzPositionTracks(sourceTracks: AlbumDossierTrack[]): DossierDisplayTrack[] {
  const positioned = sourceTracks
    .filter((t) => {
      const pos = t.musicbrainz?.position;
      return typeof pos === "number" && Number.isFinite(pos) && pos > 0;
    })
    .sort((a, b) => (a.musicbrainz!.position! as number) - (b.musicbrainz!.position! as number));

  const seen = new Set<number>();
  const out: DossierDisplayTrack[] = [];

  for (const track of positioned) {
    const pos = track.musicbrainz!.position as number;
    if (seen.has(pos)) continue;
    seen.add(pos);
    const title = splitCanonicalStem(track.title).trim() || track.title;
    out.push(
      enrichCanonicalDisplayTrack(title, pos, track, {
        canonicalRefLabel: "musicbrainz_dossier_position",
        canonicalSequenceLabel: String(pos),
      }),
    );
  }

  return out;
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

/** Original-album track rows — canonical sequence → MB sidecar → dossier MB positions → curated acoustic fallback. */
export function buildDossierTrackRows(
  albumId: string,
  sourceTracks: AlbumDossierTrack[],
): DossierTrackRow[] {
  const stemAlias = albumId === RUMOURS_DOSSIER_PROOF_RVAL ? applyRumoursStemAlias : undefined;
  const grouped = groupTracksByCanonicalStem(sourceTracks, stemAlias);
  const manualSequence = getCanonicalAlbumSequence(albumId);
  const mbSidecar = getDossierMusicBrainzSidecar(albumId);

  let displayTracks: DossierDisplayTrack[];

  if (manualSequence) {
    displayTracks = resolveCanonicalSequenceTracks(manualSequence, sourceTracks);
  } else if (mbSidecar?.tracks?.length) {
    displayTracks = resolveMusicBrainzSidecarTracks(mbSidecar, sourceTracks);
  } else {
    const fromPositions = resolveMusicBrainzPositionTracks(sourceTracks);
    if (fromPositions.length >= 3) {
      displayTracks = fromPositions;
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
